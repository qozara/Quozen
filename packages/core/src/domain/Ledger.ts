import { Expense, Settlement, Member, ExpenseCategory } from "./models";
import { DEFAULT_CATEGORIES } from "./categories";
import { calculateBalances, calculateTotalSpent, getExpenseUserStatus, suggestSettlementStrategy, ExpenseUserStatus } from "../finance";

export interface LedgerData {
    expenses: Expense[];
    settlements: Settlement[];
    members: Member[];
    categories?: ExpenseCategory[];
    isHydrated?: boolean;
}

export type LedgerProps = LedgerData;

export class Ledger {
    private _balances: Record<string, number> | null = null;
    public readonly isHydrated: boolean;

    constructor(private data: LedgerData) {
        this.isHydrated = data.isHydrated ?? true;
    }

    get members(): Member[] { return this.data.members; }
    get expenses(): Expense[] { return this.data.expenses; }
    get settlements(): Settlement[] { return this.data.settlements; }
    get categories(): ExpenseCategory[] { return this.data.categories || DEFAULT_CATEGORIES; }

    getCategory(id: string): ExpenseCategory | undefined {
        return this.categories.find(c => c.id === id);
    }

    getInvalidCategoryExpenseIds(): string[] {
        const validIds = new Set(this.categories.map(c => c.id));
        return this.data.expenses
            .filter(e => !validIds.has(e.category))
            .map(e => e.id);
    }

    getBalances(): Record<string, number> {
        if (!this._balances) {
            this._balances = calculateBalances(this.data.members, this.data.expenses, this.data.settlements);
        }
        return this._balances;
    }

    getUserBalance(userId: string): number {
        return this.getBalances()[userId] || 0;
    }

    getTotalSpent(userId: string): number {
        return calculateTotalSpent(userId, this.data.expenses);
    }

    getExpenseStatus(expenseId: string, userId: string): ExpenseUserStatus {
        const expense = this.data.expenses.find(e => e.id === expenseId);
        if (!expense) return { status: "none" };
        return getExpenseUserStatus(expense, userId);
    }

    getSettleUpSuggestion(userId: string) {
        return suggestSettlementStrategy(userId, this.getBalances(), this.data.members);
    }

    getSummary() {
        const balances = this.getBalances();
        const totalVolume = this.data.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return {
            totalVolume,
            expenseCount: this.data.expenses.length,
            settlementCount: this.data.settlements.length,
            memberCount: this.data.members.length,
            isBalanced: Math.abs(Object.values(balances).reduce((a, b) => a + b, 0)) < 0.01
        };
    }
}
