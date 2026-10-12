import type { QuozenDatabase } from "../db";
import type { CloudSyncProvider, SyncStatus } from "./types";
import { BehaviorSubject, type Observable, type Subscription } from "rxjs";

export const SYNCABLE_COLLECTIONS = ["user_settings", "expenses", "settlements", "members"] as const;

function parseTimestamp(val?: string | number | null): number {
    if (!val) return 0;
    if (typeof val === "number") return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
}

export class ReplicationCoordinator {
    private statusSubject = new BehaviorSubject<SyncStatus>("idle");
    private lastSyncedAtByDocId = new Map<string, string>();
    private isSyncing = false;
    private subscriptions: Subscription[] = [];
    private unsubscribeProviderStatus?: () => void;

    constructor(
        private db: QuozenDatabase,
        private provider: CloudSyncProvider
    ) {
        this.statusSubject.next(this.provider.getStatus());
        this.unsubscribeProviderStatus = this.provider.onStatusChange(status => {
            this.statusSubject.next(status);
        });
    }

    public get status$(): Observable<SyncStatus> {
        return this.statusSubject.asObservable();
    }

    public getStatus(): SyncStatus {
        return this.statusSubject.getValue();
    }

    public async sync(groupId?: string): Promise<void> {
        if (!this.provider.isInitialized() || this.isSyncing) return;
        this.isSyncing = true;

        try {
            const payloads = await this.provider.pull(groupId);
            const payloadMap = new Map(payloads.map(p => [p.collection, p]));

            for (const collectionName of SYNCABLE_COLLECTIONS) {
                const collection = (this.db.collections as any)[collectionName];
                if (!collection) continue;

                const isGroupScoped = collectionName !== "user_settings";
                if (isGroupScoped && !groupId) continue;

                const payload = payloadMap.get(collectionName) || {
                    collection: collectionName,
                    groupId,
                    documents: []
                };

                // 1. Fetch all local documents (including soft-deleted tombstones where deletedAt != null)
                const localDocsRaw = isGroupScoped
                    ? await collection.find({ selector: { groupId } }).exec()
                    : await collection.find().exec();

                const localDocsMap = new Map<string, Record<string, any>>(
                    localDocsRaw.map((d: any) => [d.id, d.toJSON()])
                );

                // Deduplicate remote payload by ID, keeping newest updatedAt
                const remoteDocsMap = new Map<string, Record<string, any>>();
                for (const doc of payload.documents) {
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
                        groupId,
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
            }
        } finally {
            this.isSyncing = false;
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
