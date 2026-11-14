import {
    CompositeCloudSyncProvider as BaseCompositeCloudSyncProvider,
    isNetworkError,
    parseTimestampMs,
    type CollectionRoute,
    type CompositeCloudSyncProviderOptions,
    type GroupTabularSerializer,
    type TabularRow,
} from "@qozara/cloud-sync";
import { SETTINGS_FILE_NAME, QUOZEN_PREFIX } from "../types";
import {
    SheetDataMapper,
    DEFAULT_EXPENSE_MAP,
    DEFAULT_SETTLEMENT_MAP,
    DEFAULT_MEMBER_MAP,
    DEFAULT_CATEGORY_MAP,
} from "../infrastructure/SheetDataMapper";
import { mergeUserSettingsDocs } from "./UserSettingsMerger";
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
    type CategoryDocType,
} from "../db/schemas";

export { isNetworkError };

export const DEFAULT_COLLECTION_ROUTES: Record<string, CollectionRoute> = {
    user_settings: {
        target: "blob",
        filename: SETTINGS_FILE_NAME,
    },
    members: {
        target: "tabular",
        tabName: "Members",
    },
    categories: {
        target: "tabular",
        tabName: "Categories",
    },
    expenses: {
        target: "tabular",
        tabName: "Expenses",
    },
    settlements: {
        target: "tabular",
        tabName: "Settlements",
    },
};

const tabularSerializers: Record<string, GroupTabularSerializer> = {
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
                values: SheetDataMapper.mapFromExpense(expense, headerMap),
            };
        },
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
                values: SheetDataMapper.mapFromSettlement(settlement, headerMap),
            };
        },
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
                values: SheetDataMapper.mapFromMember(member, headerMap),
            };
        },
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
                values: SheetDataMapper.mapFromCategory(category, headerMap),
            };
        },
    },
};

export class CompositeCloudSyncProvider extends BaseCompositeCloudSyncProvider {
    constructor(options: CompositeCloudSyncProviderOptions) {
        super({
            ...options,
            routes: options.routes || { ...DEFAULT_COLLECTION_ROUTES },
            groupSerializers: options.groupSerializers || tabularSerializers,
            normalizeBlobDoc:
                options.normalizeBlobDoc ??
                ((collection, raw) => (collection === "user_settings" ? userSettingsToDoc(raw) : raw)),
            filterPulledTabularDoc:
                options.filterPulledTabularDoc ??
                ((collection, doc) => Boolean(doc.id) && (collection !== "members" || Boolean(doc.userId))),
            mergeBlobPush:
                options.mergeBlobPush ??
                (async (collection, pushDocs, existingDocs, { lastPulledUpdatedAt, tabularDriver }) => {
                    if (collection !== "user_settings") {
                        const docMap = new Map(existingDocs.map((d) => [d.id, d]));
                        for (const doc of pushDocs) {
                            if (doc.id) {
                                docMap.set(doc.id, doc);
                            }
                        }
                        return { docsToWrite: Array.from(docMap.values()) };
                    }

                    const existingMap = new Map(existingDocs.map((d) => [d.id || "global_settings", d]));
                    const docsToWrite: Record<string, any>[] = [];

                    for (const pushDoc of pushDocs) {
                        const docId = pushDoc.id || "global_settings";
                        const existingDoc = existingMap.get(docId);
                        if (
                            existingDoc &&
                            lastPulledUpdatedAt &&
                            parseTimestampMs(existingDoc.updatedAt) > parseTimestampMs(lastPulledUpdatedAt)
                        ) {
                            const { mergedDoc } = mergeUserSettingsDocs(pushDoc, existingDoc);
                            docsToWrite.push(mergedDoc);
                        } else {
                            docsToWrite.push(pushDoc);
                        }
                        existingMap.delete(docId);
                    }
                    for (const remaining of existingMap.values()) {
                        docsToWrite.push(remaining);
                    }

                    const nextLastPulledUpdatedAt = docsToWrite[0]?.updatedAt || undefined;

                    const storageLayer = (tabularDriver as any)?.storageLayer;
                    if (storageLayer && typeof storageLayer.updateFile === "function") {
                        for (const doc of docsToWrite) {
                            if (Array.isArray(doc.groupCache)) {
                                for (const cg of doc.groupCache) {
                                    if (cg && cg.pendingRename === true) {
                                        try {
                                            await storageLayer.updateFile(cg.id, { name: `${QUOZEN_PREFIX}${cg.name}` });
                                            cg.pendingRename = false;
                                        } catch (renameErr) {
                                            console.warn(`[Sync] Failed to sync pending group rename for ${cg.id}:`, renameErr);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    return { docsToWrite, nextLastPulledUpdatedAt };
                }),
        });
    }
}
