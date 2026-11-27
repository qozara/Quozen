import { Expense, Settlement, Member, ExpenseCategory } from "./models";
import { DEFAULT_CATEGORIES } from "./categories";
import {
    GroupStatus,
    IGroupLifecycleState,
    normalizeGroupStatus,
    resolveGroupState,
    areAllBalancesZero as checkAllBalancesZero,
    getNonZeroBalances as extractNonZeroBalances,
} from "./GroupState";
import { calculateBalances, calculateTotalSpent, getExpenseUserStatus, suggestSettlementStrategy, ExpenseUserStatus } from "../finance";

export interface LedgerData {
    expenses: Expense[];
    settlements: Settlement[];
    members: Member[];
    categories?: ExpenseCategory[];
    isHydrated?: boolean;
    icon?: string;
    status?: GroupStatus;
}

export type LedgerProps = LedgerData;

export class Ledger {
    private _balances: Record<string, number> | null = null;
    public readonly isHydrated: boolean;
    public readonly status: GroupStatus;
    public readonly state: IGroupLifecycleState;

    constructor(private data: LedgerData) {
        this.isHydrated = data.isHydrated ?? true;
        this.status = normalizeGroupStatus(data.status);
        this.state = resolveGroupState(this.status);
    }

    get isClosed(): boolean { return this.state.isClosed; }
    get icon(): string | undefined { return this.data.icon; }
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

    areAllBalancesZero(): boolean {
        return checkAllBalancesZero(this.getBalances());
    }

    getNonZeroBalances(): Record<string, number> {
        return extractNonZeroBalances(this.getBalances());
    }

    wouldSettlementZeroAllBalances(
        candidate: { fromUserId: string; toUserId: string; amount: number },
        editingSettlementId?: string
    ): boolean {
        if (this.isClosed) return false;
        if (this.areAllBalancesZero()) return false;
        if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return false;
        if (!candidate.fromUserId || !candidate.toUserId || candidate.fromUserId === candidate.toUserId) {
            return false;
        }

        const simulatedSettlement: Settlement = {
            id: editingSettlementId || "__simulated__",
            date: new Date(),
            fromUserId: candidate.fromUserId,
            toUserId: candidate.toUserId,
            amount: candidate.amount,
            method: "cash",
        };

        const nextSettlements = editingSettlementId
            ? this.data.settlements.map((s) => (s.id === editingSettlementId ? { ...s, ...simulatedSettlement } : s))
            : [...this.data.settlements, simulatedSettlement];

        const nextBalances = calculateBalances(this.data.members, this.data.expenses, nextSettlements);
        return checkAllBalancesZero(nextBalances);
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
