export interface Group {
    id: string;
    name: string;
    description: string;
    createdBy: string;
    participants: string[];
    createdAt: Date;
    isOwner: boolean;
}

export interface User {
    id: string;
    username: string;
    email: string;
    name: string;
    picture?: string;
}

export interface ExpenseSplit {
    userId: string;
    amount: number; // Represented as integer/cents in the domain where possible
}

export interface Expense {
    id: string;
    description: string;
    amount: number;
    category: string;
    date: Date;
    paidByUserId: string;
    splits: ExpenseSplit[];
    createdAt: Date;
    updatedAt: Date;
}

export interface Settlement {
    id: string;
    date: Date;
    fromUserId: string;
    toUserId: string;
    amount: number;
    method: string;
    notes?: string;
}

export interface Member {
    userId: string;
    email: string;
    name: string;
    role: "owner" | "member";
    joinedAt: Date;
}

export interface LedgerAnalytics {
    balances: Record<string, number>;
    totalVolume: number;
    settlementSuggestions: Settlement[];
}

export interface CachedGroup {
    id: string;
    name: string;
    role: "owner" | "member";
    lastAccessed?: string;
}

export interface UserSettings {
    version: number;
    activeGroupId: string | null;
    groupCache: CachedGroup[];
    preferences: {
        defaultCurrency: string;
        theme?: "light" | "dark" | "system";
        locale?: "en" | "es" | "system";
        aiProvider?: "auto" | "byok" | "local" | "local-browser" | "cloud" | "disabled";
        ollamaBaseUrl?: string;
        ollamaModel?: string;
        byokProvider?: string;
    };
    encryptedApiKey?: string;
    lastUpdated: string;
}
