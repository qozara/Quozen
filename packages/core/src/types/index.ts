export const SCHEMAS = {
    Expenses: ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
    Settlements: ["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"],
    Members: ["userId", "email", "name", "role", "joinedAt"],
    Categories: ["id", "name", "icon", "description", "updatedAt", "deletedAt"]
} as const;

export const QUOZEN_PREFIX = "Quozen - ";
export const SETTINGS_FILE_NAME = "quozen-settings.json";
export const REQUIRED_SHEETS = ["Expenses", "Settlements", "Members"] as const;
export const GROUP_SHEETS = [...REQUIRED_SHEETS, "Categories", "_migrations"] as const;

export type SchemaType = keyof typeof SCHEMAS;

export interface Group {
    id: string;
    name: string;
    description: string;
    createdBy: string;
    participants: string[];
    createdAt: string;
    isOwner: boolean;
}

export interface User {
    id: string;
    username: string;
    email: string;
    name: string;
    picture?: string;
}

import { MemberInput } from "../domain/dtos";
export type { MemberInput };

export interface Expense {
    id: string;
    date: string;
    description: string;
    amount: number;
    paidBy: string;
    category: string;
    splits: any[];
    meta: {
        createdAt: string;
        lastModified?: string;
        [key: string]: any;
    };
    _rowIndex?: number;
}

export interface Settlement {
    id: string;
    date: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    method: string;
    notes?: string;
    _rowIndex?: number;
}

export interface Member {
    userId: string;
    email: string;
    name: string;
    role: string;
    joinedAt: string;
    _rowIndex?: number;
}

export interface GroupData {
    expenses: Expense[];
    settlements: Settlement[];
    members: Member[];
}

// --- User Settings Types ---

import { UserSettings, CachedGroup } from "../domain/models";
export type { UserSettings, CachedGroup };

export interface IStorageProvider {
    /**
     * Create a new group/spreadsheet with optional initial members.
     * Updates settings file atomically.
     */
    createGroupSheet(name: string, user: User, members?: MemberInput[]): Promise<Group>;

    /**
     * Import an existing spreadsheet into the user's settings.
     * Validates structure and adds to settings file.
     * Requires the full User object to ensure ID consistency.
     */
    importGroup(spreadsheetId: string, user: User): Promise<Group>;

    /**
     * Joins a group via a public link (Magic Link).
     * Checks if user is already a member; if not, appends them to the Member sheet.
     * Then performs an import.
     */
    joinGroup(spreadsheetId: string, user: User): Promise<Group>;

    /**
     * Update an existing group (rename and/or update members).
     * Updates settings file if name changes.
     */
    updateGroup(groupId: string, name: string, members: MemberInput[], userEmail: string): Promise<void>;

    /**
     * Permanently delete a group (Owner only).
     * Updates settings file.
     */
    deleteGroup(groupId: string, userEmail: string): Promise<void>;

    /**
     * Leave a group (Member only).
     * Updates settings file.
     */
    leaveGroup(groupId: string, userId: string, userEmail: string): Promise<void>;

    /**
     * Toggle file permissions between Restricted and Public (Anyone with link can write).
     */
    setGroupPermissions(groupId: string, access: 'public' | 'restricted'): Promise<void>;

    /**
     * Check current permissions of the group.
     * Returns 'public' if anyone with link can write, 'restricted' otherwise.
     */
    getGroupPermissions(groupId: string): Promise<'public' | 'restricted'>;

    /**
     * Check if a member has any associated expenses (paidBy or in splits)
     */
    checkMemberHasExpenses(groupId: string, userId: string): Promise<boolean>;

    /**
     * Validates that a spreadsheet has the correct Quozen structure
     */
    validateQuozenSpreadsheet(
        spreadsheetId: string,
        userEmail: string
    ): Promise<{ valid: boolean; error?: string; name?: string; data?: GroupData }>;

    /**
     * Get all data for a specific group
     */
    getGroupData(spreadsheetId: string): Promise<GroupData | null>;

    /**
     * Get a fully hydrated analytics object for a group
     */
    getGroupLedger(groupId: string): Promise<any>;

    /**
     * Get the user's groups directly
     */
    getGroups(userEmail: string): Promise<Group[]>;

    /**
     * Get all expenses for a group
     */
    getExpenses(groupId: string): Promise<Expense[]>;

    /**
     * Get all settlements for a group
     */
    getSettlements(groupId: string): Promise<Settlement[]>;

    /**
     * Get all members of a group
     */
    getMembers(groupId: string): Promise<Member[]>;

    /**
     * Get a specific expense by ID
     */
    getExpense(groupId: string, expenseId: string): Promise<Expense | null>;

    /**
     * Get a specific settlement by ID
     */
    getSettlement(groupId: string, settlementId: string): Promise<Settlement | null>;

    /**
     * Add a new expense
     */
    addExpense(spreadsheetId: string, expenseData: Partial<Expense>): Promise<void>;

    /**
     * Update an existing expense with conflict detection
     */
    updateExpense(
        spreadsheetId: string,
        expenseId: string,
        expenseData: Partial<Expense>,
        expectedLastModified?: string
    ): Promise<void>;

    /**
     * Delete an expense by ID with existence check
     */
    deleteExpense(spreadsheetId: string, expenseId: string): Promise<void>;

    /**
     * Add a new settlement
     */
    addSettlement(spreadsheetId: string, settlementData: Partial<Settlement>): Promise<void>;

    /**
     * Update an existing settlement (ID verification only, no timestamp check available in schema)
     */
    updateSettlement(spreadsheetId: string, settlementId: string, settlementData: Partial<Settlement>): Promise<void>;

    /**
     * Delete a settlement by ID with existence check
     */
    deleteSettlement(spreadsheetId: string, settlementId: string): Promise<void>;

    /**
     * Update a row in any sheet (Generic, use updateExpense for conflict checks)
     */
    updateRow(spreadsheetId: string, sheetName: SchemaType, rowIndex: number, data: any): Promise<void>;

    /**
     * Delete a row in any sheet
     */
    deleteRow(spreadsheetId: string, sheetName: SchemaType, rowIndex: number): Promise<void>;

    // --- Settings Management ---

    /**
     * Retrieves the configuration file or initializes it if missing.
     */
    getSettings(userEmail: string): Promise<UserSettings>;

    /**
     * Persists changes to settings.
     */
    saveSettings(userEmail: string, settings: UserSettings): Promise<void>;

    /**
     * Atomically updates the activeGroupId in settings.
     */
    updateActiveGroup(userEmail: string, groupId: string): Promise<void>;

    /**
     * Performs a full scan of sources to rebuild the cache and saves it.
     */
    reconcileGroups(userEmail: string): Promise<UserSettings>;

    /**
     * Get the last modified timestamp of the group file.
     */
    getLastModified(fileId: string): Promise<string>;
}
