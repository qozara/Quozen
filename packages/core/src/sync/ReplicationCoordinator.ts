import type { QuozenDatabase } from "../db";
import type { CloudSyncProvider, SyncStatus } from "./types";
import { BehaviorSubject, type Observable, type Subscription } from "rxjs";

export const SYNCABLE_COLLECTIONS = ["user_settings", "members", "categories", "expenses", "settlements"] as const;

function parseTimestamp(val?: string | number | null): number {
    if (!val) return 0;
    if (typeof val === "number") return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
}

export class ReplicationCoordinator {
    private static checkpointsByDbName = new Map<string, Map<string, string>>();

    private statusSubject = new BehaviorSubject<SyncStatus>("idle");
    private lastSyncedAtByDocId: Map<string, string>;
    private isSyncing = false;
    private hasPendingSync = false;
    private pendingSyncGroupId?: string;
    private subscriptions: Subscription[] = [];
    private unsubscribeProviderStatus?: () => void;

    constructor(
        private db: QuozenDatabase,
        private provider: CloudSyncProvider
    ) {
        this.lastSyncedAtByDocId = ReplicationCoordinator.getCheckpointMap(this.db.name);
        this.statusSubject.next(this.provider.getStatus());
        this.unsubscribeProviderStatus = this.provider.onStatusChange(status => {
            this.statusSubject.next(status);
        });
    }

    public static getCheckpointMap(dbName: string): Map<string, string> {
        let map = ReplicationCoordinator.checkpointsByDbName.get(dbName);
        if (!map) {
            map = new Map<string, string>();
            try {
                const storage = (globalThis as any).localStorage;
                if (storage && typeof storage.getItem === "function") {
                    const raw = storage.getItem(`quozen_sync_checkpoints_${dbName}`);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === "object") {
                            for (const [k, v] of Object.entries(parsed)) {
                                if (typeof v === "string") {
                                    map.set(k, v);
                                }
                            }
                        }
                    }
                }
            } catch {
                // Ignore localStorage access errors
            }
            ReplicationCoordinator.checkpointsByDbName.set(dbName, map);
        }
        return map;
    }

    public static recordHydratedCheckpoints(dbName: string, docs: Array<{ id: string; updatedAt?: string }>): void {
        const map = ReplicationCoordinator.getCheckpointMap(dbName);
        for (const doc of docs) {
            if (doc.id && doc.updatedAt) {
                map.set(doc.id, doc.updatedAt);
            }
        }
        ReplicationCoordinator.persistCheckpointMap(dbName, map);
    }

    private static persistCheckpointMap(dbName: string, map: Map<string, string>): void {
        try {
            const storage = (globalThis as any).localStorage;
            if (storage && typeof storage.setItem === "function") {
                const obj: Record<string, string> = {};
                for (const [k, v] of map.entries()) {
                    obj[k] = v;
                }
                storage.setItem(`quozen_sync_checkpoints_${dbName}`, JSON.stringify(obj));
            }
        } catch {
            // Ignore storage quota or private mode errors
        }
    }

    public get status$(): Observable<SyncStatus> {
        return this.statusSubject.asObservable();
    }

    public getStatus(): SyncStatus {
        return this.statusSubject.getValue();
    }

    public async sync(groupId?: string): Promise<void> {
        if (!this.provider.isInitialized()) return;
        const currentStatus = this.provider.getStatus();
        if (currentStatus === "upgrade_required" || currentStatus === "corrupted" || currentStatus === "incompatible") return;
        if (this.isSyncing) {
            this.hasPendingSync = true;
            if (groupId !== undefined) {
                this.pendingSyncGroupId = groupId;
            }
            return;
        }
        this.isSyncing = true;

        try {
            await this.runSyncCycle(groupId);
            while (this.hasPendingSync && this.provider.isInitialized()) {
                const nextGroupId = this.pendingSyncGroupId ?? groupId;
                this.hasPendingSync = false;
                this.pendingSyncGroupId = undefined;
                await this.runSyncCycle(nextGroupId);
            }
        } finally {
            this.isSyncing = false;
        }
    }

    private async runSyncCycle(groupId?: string): Promise<void> {
        const payloads = await this.provider.pull(groupId);
        const currentStatus = this.provider.getStatus();
        if (currentStatus === "upgrade_required" || currentStatus === "corrupted" || currentStatus === "incompatible") {
            return;
        }

        const payloadMap = new Map(payloads.map(p => [p.collection, p]));
        const targetGroupId = groupId ?? (this.provider as any).getActiveGroupId?.() ?? undefined;

        for (const collectionName of SYNCABLE_COLLECTIONS) {
            const collection = (this.db.collections as any)[collectionName];
            if (!collection) continue;

            const isGroupScoped = collectionName !== "user_settings";
            if (isGroupScoped && !targetGroupId) continue;

            // Only process collections that the remote provider actually delivered in this cycle.
            // If the provider didn't return a collection, NEVER assume remote deleted all items!
            const payload = payloadMap.get(collectionName);
            if (!payload) continue;

            // 1. Fetch all local documents (including soft-deleted tombstones where deletedAt != null)
            const localDocsRaw = isGroupScoped
                ? await collection.find({ selector: { groupId: targetGroupId } }).exec()
                : await collection.find().exec();

            const localDocsMap = new Map<string, Record<string, any>>(
                localDocsRaw.map((d: any) => [d.id, d.toJSON()])
            );

            // Deduplicate remote payload by ID, keeping newest updatedAt
            const remoteDocsMap = new Map<string, Record<string, any>>();
            for (const doc of payload.documents) {
                if (!doc.id) continue;
                const existing = remoteDocsMap.get(doc.id);
                if (!existing || parseTimestamp(doc.updatedAt) >= parseTimestamp(existing.updatedAt)) {
                    remoteDocsMap.set(doc.id, doc);
                }
            }

            const upserts: Record<string, any>[] = [];
            const pushBacks: Record<string, any>[] = [];

            // 2. Compare remote vs local via Last-Write-Wins (LWW)
            for (const remoteDoc of remoteDocsMap.values()) {
                const localDoc = localDocsMap.get(remoteDoc.id);
                const remoteTime = parseTimestamp(remoteDoc.updatedAt);

                if (localDoc) {
                    const localTime = parseTimestamp(localDoc.updatedAt);
                    const localDeleted = Boolean(localDoc.deletedAt);
                    const remoteDeleted = Boolean(remoteDoc.deletedAt);

                    if (remoteTime > localTime) {
                        upserts.push(remoteDoc);
                        this.lastSyncedAtByDocId.set(remoteDoc.id, remoteDoc.updatedAt);
                    } else if (localTime > remoteTime) {
                        pushBacks.push(localDoc);
                    } else {
                        // Tie-breaker: deletion wins if timestamps are identical
                        if (localDeleted && !remoteDeleted) {
                            pushBacks.push(localDoc);
                        } else if (remoteDeleted && !localDeleted) {
                            upserts.push(remoteDoc);
                        }
                        this.lastSyncedAtByDocId.set(remoteDoc.id, localDoc.updatedAt);
                    }
                } else {
                    if (!remoteDoc.deletedAt) {
                        upserts.push(remoteDoc);
                        this.lastSyncedAtByDocId.set(remoteDoc.id, remoteDoc.updatedAt);
                    }
                }

                localDocsMap.delete(remoteDoc.id);
            }

            // 3. Handle local documents missing from remote payload
            for (const localDoc of localDocsMap.values()) {
                if (localDoc.deletedAt) {
                    // Already deleted remotely and locally
                    this.lastSyncedAtByDocId.delete(localDoc.id);
                    continue;
                }

                const previousSyncedUpdatedAt = this.lastSyncedAtByDocId.get(localDoc.id);
                if (previousSyncedUpdatedAt && previousSyncedUpdatedAt === localDoc.updatedAt) {
                    // Previously synced and unchanged locally, but now missing from remote -> deleted remotely!
                    const nowIso = new Date().toISOString();
                    upserts.push({
                        ...localDoc,
                        deletedAt: nowIso,
                        updatedAt: nowIso
                    });
                    this.lastSyncedAtByDocId.delete(localDoc.id);
                } else {
                    // Created or modified locally while offline -> push to remote
                    pushBacks.push(localDoc);
                }
            }

            // 4. Apply local upserts and remote pushBacks
            if (upserts.length > 0) {
                await collection.bulkUpsert(upserts);
            }

            if (pushBacks.length > 0) {
                await this.provider.push({
                    collection: collectionName,
                    groupId: targetGroupId,
                    documents: pushBacks
                });
                for (const pushed of pushBacks) {
                    if (pushed.deletedAt) {
                        this.lastSyncedAtByDocId.delete(pushed.id);
                    } else {
                        this.lastSyncedAtByDocId.set(pushed.id, pushed.updatedAt);
                    }
                }
            }

            ReplicationCoordinator.persistCheckpointMap(this.db.name, this.lastSyncedAtByDocId);
        }
    }

    public destroy(): void {
        for (const sub of this.subscriptions) {
            sub.unsubscribe();
        }
        this.subscriptions = [];
        if (this.unsubscribeProviderStatus) {
            this.unsubscribeProviderStatus();
            this.unsubscribeProviderStatus = undefined;
        }
    }
}
