import type { RxJsonSchema, DeepReadonlyObject } from "rxdb";
import type { Expense, Settlement, Member, UserSettings, ExpenseSplit, CachedGroup } from "../../domain/models";
import { type ExpenseCategory, normalizeLegacyCategory } from "../../domain/categories";

export interface UserSettingsDocType {
    id: string;
    version: number;
    activeGroupId: string | null;
    groupCache: CachedGroup[];
    preferences: UserSettings["preferences"];
    encryptedApiKey?: string;
    lastUpdated: string;
    updatedAt: string;
    deletedAt?: string | null;
}

export interface ExpenseDocType {
    id: string;
    groupId: string;
    description: string;
    amount: number;
    category: string;
    date: string;
    paidByUserId: string;
    splits: ExpenseSplit[];
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
}

export interface SettlementDocType {
    id: string;
    groupId: string;
    date: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    method: string;
    notes?: string;
    updatedAt: string;
    deletedAt?: string | null;
}

export interface MemberDocType {
    id: string; // Composite `${groupId}_${userId}`
    groupId: string;
    userId: string;
    email: string;
    name: string;
    role: "owner" | "member";
    joinedAt: string;
    updatedAt: string;
    deletedAt?: string | null;
}

export interface CategoryDocType {
    id: string; // Composite `${groupId}_${categoryId}`
    groupId: string;
    categoryId: string;
    name: string;
    icon: string;
    description: string;
    sortOrder: number;
    updatedAt: string;
    deletedAt?: string | null;
}

export const userSettingsSchema: RxJsonSchema<UserSettingsDocType> = {
    title: "user_settings",
    version: 0,
    description: "Global user preferences and cached group metadata stored locally and in Drive appDataFolder",
    primaryKey: "id",
    type: "object",
    properties: {
        id: { type: "string", maxLength: 100 },
        version: { type: "number", minimum: 1 },
        activeGroupId: { type: ["string", "null"] },
        groupCache: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    role: { type: "string", enum: ["owner", "member"] },
                    accountId: { type: "string" },
                    lastAccessed: { type: "string" },
                    validationStatus: { type: "string" },
                    isHydrated: { type: "boolean" },
                    pendingRename: { type: "boolean" }
                },
                required: ["id", "name", "role"]
            }
        },
        preferences: {
            type: "object",
            properties: {
                defaultCurrency: { type: "string" },
                theme: { type: "string" },
                locale: { type: "string" },
                aiProvider: { type: "string" },
                ollamaBaseUrl: { type: "string" },
                ollamaModel: { type: "string" },
                byokProvider: { type: "string" }
            },
            required: ["defaultCurrency"]
        },
        encryptedApiKey: { type: "string" },
        lastUpdated: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] }
    },
    required: ["id", "version", "groupCache", "preferences", "lastUpdated", "updatedAt"]
};

export const expenseSchema: RxJsonSchema<ExpenseDocType> = {
    title: "expenses",
    version: 1,
    description: "Group expense records partitioned by groupId",
    primaryKey: "id",
    type: "object",
    properties: {
        id: { type: "string", maxLength: 100 },
        groupId: { type: "string", maxLength: 100 },
        description: { type: "string" },
        amount: { type: "number" },
        category: { type: "string" },
        date: { type: "string", maxLength: 50 },
        paidByUserId: { type: "string" },
        splits: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    userId: { type: "string" },
                    amount: { type: "number" }
                },
                required: ["userId", "amount"]
            }
        },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] }
    },
    required: [
        "id",
        "groupId",
        "description",
        "amount",
        "category",
        "date",
        "paidByUserId",
        "splits",
        "createdAt",
        "updatedAt"
    ],
    indexes: ["groupId", ["groupId", "date"]]
};

export const expenseMigrationStrategies = {
    1: (oldDoc: any) => {
        return {
            ...oldDoc,
            category: normalizeLegacyCategory(oldDoc.category)
        };
    }
};

export const settlementSchema: RxJsonSchema<SettlementDocType> = {
    title: "settlements",
    version: 0,
    description: "Group settlement records partitioned by groupId",
    primaryKey: "id",
    type: "object",
    properties: {
        id: { type: "string", maxLength: 100 },
        groupId: { type: "string", maxLength: 100 },
        date: { type: "string", maxLength: 50 },
        fromUserId: { type: "string" },
        toUserId: { type: "string" },
        amount: { type: "number" },
        method: { type: "string" },
        notes: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] }
    },
    required: ["id", "groupId", "date", "fromUserId", "toUserId", "amount", "method", "updatedAt"],
    indexes: ["groupId", ["groupId", "date"]]
};

export const memberSchema: RxJsonSchema<MemberDocType> = {
    title: "members",
    version: 0,
    description: "Group member records partitioned by groupId",
    primaryKey: "id",
    type: "object",
    properties: {
        id: { type: "string", maxLength: 200 },
        groupId: { type: "string", maxLength: 100 },
        userId: { type: "string", maxLength: 100 },
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string", enum: ["owner", "member"] },
        joinedAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] }
    },
    required: ["id", "groupId", "userId", "name", "role", "joinedAt", "updatedAt"],
    indexes: ["groupId", ["groupId", "userId"]]
};

export const categorySchema: RxJsonSchema<CategoryDocType> = {
    title: "categories",
    version: 0,
    description: "Group expense categories partitioned by groupId",
    primaryKey: "id",
    type: "object",
    properties: {
        id: { type: "string", maxLength: 200 },
        groupId: { type: "string", maxLength: 100 },
        categoryId: { type: "string", maxLength: 100 },
        name: { type: "string" },
        icon: { type: "string" },
        description: { type: "string" },
        sortOrder: { type: "number" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] }
    },
    required: ["id", "groupId", "categoryId", "name", "icon", "description", "updatedAt"],
    indexes: ["groupId", ["groupId", "categoryId"]]
};

// --- Domain <-> RxDB Document Mappers ---

function safeIsoString(val: unknown, fallbackIso?: string): string {
    if (val instanceof Date && !isNaN(val.getTime())) {
        return val.toISOString();
    }
    if (typeof val === "string" || typeof val === "number") {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            return d.toISOString();
        }
    }
    return fallbackIso ?? new Date().toISOString();
}

export function expenseToDoc(expense: Expense, groupId: string): ExpenseDocType {
    const nowIso = new Date().toISOString();
    const dateIso = safeIsoString(expense.date, nowIso);
    const createdIso = expense.createdAt ? safeIsoString(expense.createdAt, dateIso) : nowIso;
    const updatedIso = expense.updatedAt ? safeIsoString(expense.updatedAt, createdIso) : nowIso;
    return {
        id: expense.id,
        groupId,
        description: expense.description || "",
        amount: Number(expense.amount) || 0,
        category: expense.category || "",
        date: dateIso,
        paidByUserId: expense.paidByUserId || "",
        splits: (expense.splits || []).map(s => ({ userId: s.userId, amount: Number(s.amount) || 0 })),
        createdAt: createdIso,
        updatedAt: updatedIso,
        deletedAt: expense.deletedAt ? safeIsoString(expense.deletedAt, updatedIso) : null
    };
}

export function docToExpense(doc: ExpenseDocType | DeepReadonlyObject<ExpenseDocType>): Expense {
    const expense: Expense = {
        id: doc.id,
        description: doc.description,
        amount: doc.amount,
        category: doc.category,
        date: new Date(doc.date),
        paidByUserId: doc.paidByUserId,
        splits: (doc.splits || []).map(s => ({ userId: s.userId, amount: s.amount })),
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt)
    };
    if (doc.deletedAt) {
        expense.deletedAt = new Date(doc.deletedAt);
    }
    return expense;
}

export function settlementToDoc(settlement: Settlement, groupId: string): SettlementDocType {
    const dateIso = safeIsoString(settlement.date);
    const updatedIso = settlement.updatedAt
        ? safeIsoString(settlement.updatedAt, dateIso)
        : dateIso;
    return {
        id: settlement.id,
        groupId,
        date: dateIso,
        fromUserId: settlement.fromUserId || "",
        toUserId: settlement.toUserId || "",
        amount: Number(settlement.amount) || 0,
        method: settlement.method || "cash",
        notes: settlement.notes || "",
        updatedAt: updatedIso,
        deletedAt: settlement.deletedAt ? safeIsoString(settlement.deletedAt, updatedIso) : null
    };
}

export function docToSettlement(doc: SettlementDocType | DeepReadonlyObject<SettlementDocType>): Settlement {
    const settlement: Settlement = {
        id: doc.id,
        date: new Date(doc.date),
        fromUserId: doc.fromUserId,
        toUserId: doc.toUserId,
        amount: doc.amount,
        method: doc.method,
        notes: doc.notes,
        updatedAt: new Date(doc.updatedAt || doc.date)
    };
    if (doc.deletedAt) {
        settlement.deletedAt = new Date(doc.deletedAt);
    }
    return settlement;
}

export function memberToDoc(member: Member, groupId: string): MemberDocType {
    const joinedIso = safeIsoString(member.joinedAt);
    const updatedIso = member.updatedAt
        ? safeIsoString(member.updatedAt, joinedIso)
        : joinedIso;
    return {
        id: `${groupId}_${member.userId}`,
        groupId,
        userId: member.userId,
        email: member.email || "",
        name: member.name || "",
        role: member.role,
        joinedAt: joinedIso,
        updatedAt: updatedIso,
        deletedAt: member.deletedAt ? safeIsoString(member.deletedAt, updatedIso) : null
    };
}

export function docToMember(doc: MemberDocType | DeepReadonlyObject<MemberDocType>): Member {
    const member: Member = {
        userId: doc.userId,
        email: doc.email || "",
        name: doc.name,
        role: doc.role,
        joinedAt: new Date(doc.joinedAt),
        updatedAt: new Date(doc.updatedAt || doc.joinedAt)
    };
    if (doc.deletedAt) {
        member.deletedAt = new Date(doc.deletedAt);
    }
    return member;
}

export function userSettingsToDoc(settings: UserSettings, id = "global_settings"): UserSettingsDocType {
    const nowIso = settings.lastUpdated || new Date().toISOString();
    return {
        id,
        version: settings.version || 1,
        activeGroupId: settings.activeGroupId ?? null,
        groupCache: (settings.groupCache || []).map(g => ({ ...g })),
        preferences: { ...settings.preferences },
        encryptedApiKey: settings.encryptedApiKey,
        lastUpdated: nowIso,
        updatedAt: nowIso,
        deletedAt: null
    };
}

export function docToUserSettings(doc: UserSettingsDocType | DeepReadonlyObject<UserSettingsDocType>): UserSettings {
    const settings: UserSettings = {
        version: doc.version,
        activeGroupId: doc.activeGroupId,
        groupCache: (doc.groupCache || []).map(g => ({ ...g })),
        preferences: { ...doc.preferences },
        lastUpdated: doc.lastUpdated || doc.updatedAt
    };
    if (doc.encryptedApiKey !== undefined) {
        settings.encryptedApiKey = doc.encryptedApiKey;
    }
    return settings;
}

export function categoryToDoc(category: ExpenseCategory, groupId: string): CategoryDocType {
    const nowIso = new Date().toISOString();
    const updatedIso = category.updatedAt ? safeIsoString(category.updatedAt, nowIso) : nowIso;
    return {
        id: `${groupId}_${category.id}`,
        groupId,
        categoryId: category.id,
        name: category.name || "",
        icon: category.icon || "tag",
        description: category.description || "",
        sortOrder: typeof category.sortOrder === "number" ? category.sortOrder : 0,
        updatedAt: updatedIso,
        deletedAt: category.deletedAt ? safeIsoString(category.deletedAt, updatedIso) : null
    };
}

export function docToCategory(doc: CategoryDocType | DeepReadonlyObject<CategoryDocType>): ExpenseCategory {
    const cat: ExpenseCategory = {
        id: doc.categoryId || doc.id.split("_").slice(1).join("_"),
        name: doc.name,
        icon: doc.icon,
        description: doc.description,
        sortOrder: doc.sortOrder
    };
    if (doc.updatedAt) {
        cat.updatedAt = new Date(doc.updatedAt);
    }
    if (doc.deletedAt) {
        cat.deletedAt = new Date(doc.deletedAt);
    }
    return cat;
}
