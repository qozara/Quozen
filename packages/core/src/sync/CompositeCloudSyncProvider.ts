import type {
    CloudSyncProvider,
    CompositeCloudSyncProviderOptions,
    CollectionRoute,
    BlobStorageDriver,
    TabularStorageDriver,
    TabularRow,
    SyncDeltaPayload,
    SyncStatus
} from "./types";
import { SETTINGS_FILE_NAME } from "../types";
import { SheetDataMapper, DEFAULT_EXPENSE_MAP, DEFAULT_SETTLEMENT_MAP, DEFAULT_MEMBER_MAP, DEFAULT_CATEGORY_MAP } from "../infrastructure/SheetDataMapper";
import {
    expenseToDoc,
    docToExpense,
    settlementToDoc,
    docToSettlement,
    memberToDoc,
    docToMember,
    categoryToDoc,
    docToCategory,
    userSettingsToDoc,
    type ExpenseDocType,
    type SettlementDocType,
    type MemberDocType,
    type CategoryDocType
} from "../db/schemas";

export const DEFAULT_COLLECTION_ROUTES: Record<string, CollectionRoute> = {
    user_settings: {
        target: "blob",
        filename: SETTINGS_FILE_NAME
    },
    members: {
        target: "tabular",
        tabName: "Members"
    },
    categories: {
        target: "tabular",
        tabName: "Categories"
    },
    expenses: {
        target: "tabular",
        tabName: "Expenses"
    },
    settlements: {
        target: "tabular",
        tabName: "Settlements"
    }
};

interface CollectionTabularSerializer {
    defaultHeaders: string[];
    rowToDoc(row: TabularRow, groupId: string): Record<string, any>;
    docToRow(doc: Record<string, any>, headers?: string[]): TabularRow;
}

const tabularSerializers: Record<string, CollectionTabularSerializer> = {
    expenses: {
        defaultHeaders: ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
        rowToDoc(row: TabularRow, groupId: string) {
            const headerMap = row.headers ? SheetDataMapper.buildHeaderMap(row.headers) : DEFAULT_EXPENSE_MAP;
            const mapped = SheetDataMapper.mapToExpense(row.values, 2, headerMap);
            return expenseToDoc(mapped.entity, groupId);
        },
        docToRow(doc: Record<string, any>, headers?: string[]): TabularRow {
            const headerMap = headers ? SheetDataMapper.buildHeaderMap(headers) : DEFAULT_EXPENSE_MAP;
            const expense = docToExpense(doc as ExpenseDocType);
            return {
                id: doc.id,
                updatedAt: doc.updatedAt,
                deletedAt: doc.deletedAt,
                headers: headers || this.defaultHeaders,
                values: SheetDataMapper.mapFromExpense(expense, headerMap)
            };
        }
    },
    settlements: {
        defaultHeaders: ["id", "date", "fromUserId", "toUserId", "amount", "method", "notes", "updatedAt"],
        rowToDoc(row: TabularRow, groupId: string) {
            const headerMap = row.headers ? SheetDataMapper.buildHeaderMap(row.headers) : DEFAULT_SETTLEMENT_MAP;
            const mapped = SheetDataMapper.mapToSettlement(row.values, 2, headerMap);
            return settlementToDoc(mapped.entity, groupId);
        },
        docToRow(doc: Record<string, any>, headers?: string[]): TabularRow {
            const targetHeaders = headers || this.defaultHeaders;
            const headerMap = SheetDataMapper.buildHeaderMap(targetHeaders);
            const settlement = docToSettlement(doc as SettlementDocType);
            return {
                id: doc.id,
                updatedAt: doc.updatedAt,
                deletedAt: doc.deletedAt,
                headers: targetHeaders,
                values: SheetDataMapper.mapFromSettlement(settlement, headerMap)
            };
        }
    },
    members: {
        defaultHeaders: ["userId", "email", "name", "role", "joinedAt", "updatedAt"],
        rowToDoc(row: TabularRow, groupId: string) {
            const headerMap = row.headers ? SheetDataMapper.buildHeaderMap(row.headers) : DEFAULT_MEMBER_MAP;
            const mapped = SheetDataMapper.mapToMember(row.values, 2, headerMap);
            return memberToDoc(mapped.entity, groupId);
        },
        docToRow(doc: Record<string, any>, headers?: string[]): TabularRow {
            const targetHeaders = headers || this.defaultHeaders;
            const headerMap = SheetDataMapper.buildHeaderMap(targetHeaders);
            const member = docToMember(doc as MemberDocType);
            return {
                id: doc.id,
                updatedAt: doc.updatedAt,
                deletedAt: doc.deletedAt,
                headers: targetHeaders,
                values: SheetDataMapper.mapFromMember(member, headerMap)
            };
        }
    },
    categories: {
        defaultHeaders: ["id", "name", "icon", "description", "updatedAt"],
        rowToDoc(row: TabularRow, groupId: string) {
            const headerMap = row.headers ? SheetDataMapper.buildHeaderMap(row.headers) : DEFAULT_CATEGORY_MAP;
            const mapped = SheetDataMapper.mapToCategory(row.values, 2, headerMap);
            return categoryToDoc(mapped.entity, groupId);
        },
        docToRow(doc: Record<string, any>, headers?: string[]): TabularRow {
            const targetHeaders = headers || this.defaultHeaders;
            const headerMap = SheetDataMapper.buildHeaderMap(targetHeaders);
            const category = docToCategory(doc as CategoryDocType);
            return {
                id: doc.id,
                updatedAt: doc.updatedAt,
                deletedAt: doc.deletedAt,
                headers: targetHeaders,
                values: SheetDataMapper.mapFromCategory(category, headerMap)
            };
        }
    }
};

export function isNetworkError(err: any): boolean {
    if (!err) return false;
    if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
        return true;
    }
    const msg = String(err?.message || err).toLowerCase();
    return (
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("econnreset") ||
        msg.includes("enotfound") ||
        msg.includes("etimedout")
    );
}

export class CompositeCloudSyncProvider implements CloudSyncProvider {
    id: string;
    name: string;
    description?: string;

    protected initialized = false;
    protected status: SyncStatus = "disconnected";
    protected lastSyncedTime: string | null = null;
    protected statusListeners: Set<(status: SyncStatus) => void> = new Set();
    protected blobDriver?: BlobStorageDriver;
    protected tabularDriver?: TabularStorageDriver;
    protected routes: Record<string, CollectionRoute>;
    protected activeGroupId: string | null;

    constructor(options: CompositeCloudSyncProviderOptions) {
        this.id = options.id;
        this.name = options.name;
        this.description = options.description;
        this.blobDriver = options.blobDriver;
        this.tabularDriver = options.tabularDriver;
        this.routes = options.routes || { ...DEFAULT_COLLECTION_ROUTES };
        this.activeGroupId = options.activeGroupId ?? null;
    }

    setActiveGroupId(groupId: string | null): void {
        this.activeGroupId = groupId;
    }

    getActiveGroupId(): string | null {
        return this.activeGroupId;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getStatus(): SyncStatus {
        return this.status;
    }

    getLastSyncedTime(): string | null {
        return this.lastSyncedTime;
    }

    onStatusChange(listener: (status: SyncStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    protected setStatus(newStatus: SyncStatus): void {
        this.status = newStatus;
        for (const listener of this.statusListeners) {
            try {
                listener(newStatus);
            } catch (err) {
                console.error("Error in status change listener", err);
            }
        }
    }

    async initialize(_credentials?: any): Promise<void> {
        this.initialized = true;
        this.lastSyncedTime = new Date().toISOString();
        this.setStatus("idle");
    }

    async disconnect(): Promise<void> {
        this.initialized = false;
        this.setStatus("disconnected");
    }

    async repair(groupId: string): Promise<void> {
        if (!this.tabularDriver?.repairTable) {
            throw new Error("Repair is not supported by this tabular driver");
        }
        this.setStatus("syncing");
        try {
            await this.tabularDriver.repairTable(groupId);
            this.setStatus("idle");
        } catch (err) {
            this.setStatus("corrupted");
            throw err;
        }
    }

    async migrate(groupId: string): Promise<void> {
        if (!this.tabularDriver?.migrateTable) {
            throw new Error("Migration is not supported by this tabular driver");
        }
        this.setStatus("syncing");
        try {
            await this.tabularDriver.migrateTable(groupId);
            this.setStatus("idle");
        } catch (err) {
            this.setStatus("upgrade_required");
            throw err;
        }
    }

    async pull(groupId?: string): Promise<SyncDeltaPayload[]> {
        if (!this.initialized) return [];
        const targetGroupId = groupId ?? this.activeGroupId;

        this.setStatus("syncing");
        try {
            const results: SyncDeltaPayload[] = [];

            for (const [collection, route] of Object.entries(this.routes)) {
                if (route.target === "blob" && this.blobDriver) {
                    const rawBlob = await this.blobDriver.readBlob<any>(route.filename);
                    if (rawBlob) {
                        const docs = Array.isArray(rawBlob)
                            ? rawBlob
                            : [rawBlob.id ? rawBlob : userSettingsToDoc(rawBlob)];
                        results.push({ collection, documents: docs });
                    }
                } else if (route.target === "tabular" && this.tabularDriver && targetGroupId) {
                    const serializer = tabularSerializers[collection];
                    if (serializer) {
                        try {
                            const rows = await this.tabularDriver.readTable(targetGroupId, route.tabName);
                            const documents = rows
                                .map(r => serializer.rowToDoc(r, targetGroupId))
                                .filter(d => Boolean(d.id) && (collection !== "members" || Boolean(d.userId)));
                            results.push({ collection, groupId: targetGroupId, documents });
                        } catch (tabErr: any) {
                            if (collection === "categories" && String(tabErr?.message || "").includes("Categories")) {
                                // Missing Categories tab on legacy sheet is non-blocking; background migration will initialize it
                            } else {
                                throw tabErr;
                            }
                        }
                    }
                }
            }

            this.lastSyncedTime = new Date().toISOString();
            this.setStatus("idle");
            return results;
        } catch (err: any) {
            this.handleSyncException(err);
            throw err;
        }
    }

    async push(payload: SyncDeltaPayload): Promise<void> {
        if (!this.initialized) return;

        this.setStatus("syncing");
        try {
            const route = this.routes[payload.collection];
            if (!route) return;

            if (route.target === "blob") {
                if (!this.blobDriver) {
                    throw new Error(`BlobStorageDriver is required for collection "${payload.collection}"`);
                }
                const existingRaw = await this.blobDriver.readBlob<any>(route.filename);
                const existingDocs: Record<string, any>[] = existingRaw
                    ? Array.isArray(existingRaw)
                        ? existingRaw
                        : [existingRaw.id ? existingRaw : userSettingsToDoc(existingRaw)]
                    : [];

                const docMap = new Map(existingDocs.map(d => [d.id, d]));
                for (const doc of payload.documents) {
                    if (doc.id) {
                        docMap.set(doc.id, doc);
                    }
                }
                await this.blobDriver.writeBlob(route.filename, Array.from(docMap.values()));
            } else if (route.target === "tabular") {
                if (!this.tabularDriver) {
                    throw new Error(`TabularStorageDriver is required for collection "${payload.collection}"`);
                }
                const targetGroupId = payload.groupId || payload.documents[0]?.groupId || this.activeGroupId;
                if (!targetGroupId) {
                    throw new Error(`groupId is required to push tabular collection "${payload.collection}"`);
                }

                const serializer = tabularSerializers[payload.collection];
                if (!serializer) {
                    throw new Error(`No serializer registered for tabular collection "${payload.collection}"`);
                }

                let existingRows: TabularRow[] = [];
                try {
                    existingRows = await this.tabularDriver.readTable(targetGroupId, route.tabName);
                } catch (readErr: any) {
                    if (payload.collection === "categories" && String(readErr?.message || "").includes("Categories")) {
                        // Remote sheet does not have Categories tab yet; skip push until migration runs
                        return;
                    }
                    throw readErr;
                }

                const rawHeaders = existingRows[0]?.headers || serializer.defaultHeaders;
                const headersToWrite = [...rawHeaders];
                if (
                    (payload.collection === "settlements" || payload.collection === "members") &&
                    !headersToWrite.some(h => h.trim().toLowerCase() === "updatedat")
                ) {
                    headersToWrite.push("updatedAt");
                }
                const existingDocs = existingRows
                    .map(r => serializer.rowToDoc(r, targetGroupId))
                    .filter(d => Boolean(d.id) && (payload.collection !== "members" || Boolean(d.userId)));

                const docMap = new Map(existingDocs.map(d => [d.id, d]));
                for (const doc of payload.documents) {
                    if (doc.id) {
                        if (doc.deletedAt) {
                            docMap.delete(doc.id);
                        } else {
                            docMap.set(doc.id, doc);
                        }
                    }
                }

                const activeDocs = Array.from(docMap.values()).filter(d => !d.deletedAt);
                const rows = activeDocs.map(d => serializer.docToRow(d, headersToWrite));
                try {
                    await this.tabularDriver.writeTable(targetGroupId, route.tabName, headersToWrite, rows);
                } catch (writeErr: any) {
                    if (payload.collection === "categories" && String(writeErr?.message || "").includes("Categories")) {
                        return;
                    }
                    throw writeErr;
                }
            }

            this.lastSyncedTime = new Date().toISOString();
            this.setStatus("idle");
        } catch (err: any) {
            this.handleSyncException(err);
            throw err;
        }
    }

    private handleSyncException(err: any): void {
        const msg = String(err?.message || err);
        if (msg.includes("corruption") || msg.includes("missing required column") || err?.name === "SchemaCorruptedError") {
            this.setStatus("corrupted");
        } else if (msg.includes("upgrade") || err?.name === "SchemaUpgradeRequiredError") {
            this.setStatus("upgrade_required");
        } else if (msg.includes("Google Auth Failed") || msg.includes("401") || msg.includes("unauthorized")) {
            this.setStatus("auth_failed");
        } else if (msg.includes("Rate Limit") || msg.includes("429")) {
            this.setStatus("throttled");
        } else if (isNetworkError(err)) {
            this.setStatus("idle");
        } else {
            this.setStatus("error");
        }
    }
}
