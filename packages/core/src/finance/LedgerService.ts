import { LedgerRepository } from "../infrastructure/LedgerRepository";
import { User, Expense, Settlement, Member, ExpenseCategory } from "../domain/models";
import { CreateExpenseDTO, UpdateExpenseDTO, CreateSettlementDTO, UpdateSettlementDTO } from "../domain/dtos";
import { Ledger } from "../domain/Ledger";
import { ConflictError, SchemaCorruptedError, SchemaUpgradeRequiredError, SchemaIncompatibleError, InvalidCategoryError, TableNotFoundError } from "../errors";
import { resolveCategory, DEFAULT_CATEGORY_ID, DEFAULT_CATEGORIES } from "../domain/categories";
import { distributeAmount } from "./index";
import { ValidationService, ValidationStatus } from "../schema/ValidationService";

export class LedgerService {
    constructor(
        private repo: LedgerRepository,
        private user: User,
        private validationSvc?: ValidationService,
        private groupId?: string,
        private activeAccountId?: string,
        private getActiveAccountId?: () => Promise<string | undefined>
    ) { }

    private async resolveEffectiveAccountId(): Promise<string | undefined> {
        if (this.activeAccountId) return this.activeAccountId;
        if (this.getActiveAccountId) {
            try {
                return await this.getActiveAccountId();
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    private async ensureSchemaHealth(): Promise<void> {
        if (typeof this.repo.hasLocalDb === "function" && this.repo.hasLocalDb()) return;
        if (!this.validationSvc || !this.groupId) return;
        
        // Skip background schema health checks during E2E tests to prevent flaky network mocks
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_USE_MOCK_STORAGE === 'true' || import.meta.env.VITE_USE_MOCK_STORAGE === 'remote')) {
            return;
        }

        let health;
        try {
            health = await this.validationSvc.checkHealth(this.groupId);
        } catch (e: any) {
            if (e instanceof SchemaIncompatibleError || e?.name === "SchemaIncompatibleError") {
                throw e;
            }
            if (e instanceof SchemaUpgradeRequiredError || e?.name === "SchemaUpgradeRequiredError" || e instanceof TableNotFoundError || e?.name === "TableNotFoundError") {
                throw new SchemaUpgradeRequiredError();
            }
            // Ignore network or fetch errors during health check (for offline cache support)
            // But if it's a parsing error or unexpected crash, treat it as corruption rather than silently bypassing validation.
            if (e.message && (e.message.toLowerCase().includes('fetch') || e.message.toLowerCase().includes('network'))) {
                return;
            }
            throw new SchemaCorruptedError();
        }

        if (health.status === ValidationStatus.INCOMPATIBLE) {
            throw new SchemaIncompatibleError();
        }
        if (health.status === ValidationStatus.CORRUPTED) {
            throw new SchemaCorruptedError();
        }
        if (health.status === ValidationStatus.UPGRADE_REQUIRED) {
            throw new SchemaUpgradeRequiredError();
        }
    }

    public async repairSchema(): Promise<void> {
        if (!this.validationSvc || !this.groupId) throw new Error("Validation service not available");
        await this.validationSvc.repairFile(this.groupId);
    }

    public async migrateSchema(): Promise<void> {
        if (!this.validationSvc || !this.groupId) throw new Error("Validation service not available");
        await this.validationSvc.migrateFile(this.groupId);
    }

    async getExpenses(): Promise<Expense[]> {
        return this.repo.getExpenses();
    }

    private async assertMembership(): Promise<Member[]> {
        const members = await this.repo.getMembers();
        const userEmail = (this.user.email || "").trim().toLowerCase();
        const effectiveAccountId = await this.resolveEffectiveAccountId();
        const isMember = members.some(
            m =>
                (effectiveAccountId && m.userId === effectiveAccountId) ||
                m.userId === this.user.id ||
                (userEmail && (m.email || "").trim().toLowerCase() === userEmail) ||
                (userEmail && (m.userId || "").trim().toLowerCase() === userEmail)
        );
        if (!isMember) throw new Error("Forbidden: User is not a member of this group");
        return members;
    }

    private assertValidAmount(amount: unknown, fieldName: string = "Amount"): number {
        const num = Number(amount);
        if (!Number.isFinite(num) || num <= 0) {
            throw new Error(`${fieldName} must be a positive number`);
        }
        return num;
    }

    async addExpense(payload: CreateExpenseDTO): Promise<Expense> {
        const members = await this.assertMembership();
        this.assertValidAmount(payload.amount, "Expense amount");

        let splits = payload.splits || [];
        if (splits.length === 0 && members.length > 0) {
            const amounts = distributeAmount(payload.amount, members.length);
            splits = members.map((m, i) => ({ userId: m.userId, amount: amounts[i] }));
        }

        for (const s of splits) {
            const sAmount = Number(s.amount);
            if (!Number.isFinite(sAmount) || sAmount < 0) {
                throw new Error("Split amount must be a non-negative number");
            }
        }

        // Validate splits mismatch
        const splitSum = splits.reduce((sum, s) => sum + s.amount, 0);
        if (Math.abs(splitSum - payload.amount) > 0.01) {
            throw new Error("Splits mismatch");
        }

        const categories = typeof this.repo.getCategories === "function"
            ? await this.repo.getCategories()
            : DEFAULT_CATEGORIES;
        let resolvedCategory = DEFAULT_CATEGORY_ID;
        if (payload.category) {
            const matched = resolveCategory(payload.category, categories);
            if (!matched) {
                throw new InvalidCategoryError(`Category "${payload.category}" is invalid or not available in this group.`);
            }
            resolvedCategory = matched.id;
        }

        const expense: Expense = {
            id: crypto.randomUUID(),
            description: payload.description,
            amount: payload.amount,
            category: resolvedCategory,
            date: new Date(payload.date),
            paidByUserId: payload.paidByUserId,
            splits: splits,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await this.repo.addExpense(expense);
        return expense;
    }

    async updateExpense(expenseId: string, payload: UpdateExpenseDTO, expectedLastModified?: Date): Promise<void> {
        await this.assertMembership();
        if (payload.amount !== undefined) {
            this.assertValidAmount(payload.amount, "Expense amount");
        }

        const expenses = await this.repo.getExpenses();
        const current = expenses.find(e => e.id === expenseId);
        if (!current) throw new Error("Expense not found");

        if (expectedLastModified && current.updatedAt.getTime() > expectedLastModified.getTime()) {
            throw new ConflictError("Data has been modified by another user.");
        }

        let newCategory = current.category;
        if (payload.category !== undefined) {
            const categories = typeof this.repo.getCategories === "function"
            ? await this.repo.getCategories()
            : DEFAULT_CATEGORIES;
            const matched = resolveCategory(payload.category, categories);
            if (!matched) {
                throw new InvalidCategoryError(`Category "${payload.category}" is invalid or not available in this group.`);
            }
            newCategory = matched.id;
        }

        // Validate splits mismatch if amount or splits are updated
        const newAmount = payload.amount ?? current.amount;
        const newSplits = payload.splits ?? current.splits;
        for (const s of newSplits) {
            const sAmount = Number(s.amount);
            if (!Number.isFinite(sAmount) || sAmount < 0) {
                throw new Error("Split amount must be a non-negative number");
            }
        }
        const splitSum = newSplits.reduce((sum, s) => sum + s.amount, 0);
        if (Math.abs(splitSum - newAmount) > 0.01) {
            throw new Error("Splits mismatch");
        }

        const updated: Expense = {
            ...current,
            description: payload.description ?? current.description,
            amount: payload.amount ?? current.amount,
            category: newCategory,
            date: payload.date ? new Date(payload.date) : current.date,
            paidByUserId: payload.paidByUserId ?? current.paidByUserId,
            splits: payload.splits ?? current.splits,
            updatedAt: new Date()
        };

        await this.repo.updateExpense(updated, expectedLastModified);
    }

    async deleteExpense(expenseId: string): Promise<void> {
        await this.assertMembership();
        await this.repo.deleteExpense(expenseId);
    }

    async getSettlements(): Promise<Settlement[]> {
        return this.repo.getSettlements();
    }

    async addSettlement(payload: CreateSettlementDTO): Promise<Settlement> {
        await this.assertMembership();
        this.assertValidAmount(payload.amount, "Settlement amount");
        if (payload.fromUserId === payload.toUserId) {
            throw new Error("A user cannot settle with themselves");
        }

        const now = new Date();
        const settlement: Settlement = {
            id: crypto.randomUUID(),
            date: payload.date || now,
            fromUserId: payload.fromUserId,
            toUserId: payload.toUserId,
            amount: payload.amount,
            method: payload.method || 'cash',
            notes: payload.notes,
            updatedAt: now
        };
        await this.repo.addSettlement(settlement);
        return settlement;
    }

    async updateSettlement(settlementId: string, payload: UpdateSettlementDTO): Promise<void> {
        await this.assertMembership();
        if (payload.amount !== undefined) {
            this.assertValidAmount(payload.amount, "Settlement amount");
        }

        const settlements = await this.repo.getSettlements();
        const current = settlements.find(s => s.id === settlementId);
        if (!current) throw new Error("Settlement not found");

        const targetFrom = payload.fromUserId ?? current.fromUserId;
        const targetTo = payload.toUserId ?? current.toUserId;
        if (targetFrom === targetTo) {
            throw new Error("A user cannot settle with themselves");
        }

        const updated: Settlement = {
            ...current,
            date: payload.date ?? current.date,
            fromUserId: targetFrom,
            toUserId: targetTo,
            amount: payload.amount ?? current.amount,
            method: payload.method ?? current.method,
            notes: payload.notes ?? current.notes,
            updatedAt: new Date()
        };

        await this.repo.updateSettlement(updated);
    }

    async deleteSettlement(settlementId: string): Promise<void> {
        await this.assertMembership();
        await this.repo.deleteSettlement(settlementId);
    }

    async getMembers() {
        return this.repo.getMembers();
    }

    async renameMember(userId: string, newName: string): Promise<void> {
        const trimmed = newName.trim();
        if (!trimmed) throw new Error("Account name cannot be empty");
        const members = await this.repo.getMembers();
        const member = members.find(m => m.userId === userId);
        if (!member) throw new Error("Member not found");
        await this.repo.updateMember({
            ...member,
            name: trimmed,
            updatedAt: new Date()
        });
    }

    async removeUnusedMember(userId: string): Promise<boolean> {
        const [members, expenses, settlements] = await Promise.all([
            this.repo.getMembers(),
            this.repo.getExpenses(),
            this.repo.getSettlements()
        ]);
        const member = members.find(m => m.userId === userId);
        if (!member || member.role === "owner") {
            return false;
        }
        const hasExpenses = expenses.some(
            e => e.paidByUserId === userId || e.splits?.some(s => s.userId === userId && s.amount > 0)
        );
        const hasSettlements = settlements.some(
            s => s.fromUserId === userId || s.toUserId === userId
        );
        if (hasExpenses || hasSettlements) {
            return false;
        }
        await this.repo.deleteMember(userId);
        return true;
    }

    async getCategories(): Promise<ExpenseCategory[]> {
        return typeof this.repo.getCategories === "function"
            ? this.repo.getCategories()
            : Promise.resolve(DEFAULT_CATEGORIES);
    }

    async getLedger(): Promise<Ledger> {
        await this.ensureSchemaHealth();

        const [expenses, settlements, members, categories] = await Promise.all([
            this.repo.getExpenses(),
            this.repo.getSettlements(),
            this.repo.getMembers(),
            typeof this.repo.getCategories === "function" ? this.repo.getCategories() : Promise.resolve(DEFAULT_CATEGORIES)
        ]);

        const effectiveAccountId = await this.resolveEffectiveAccountId();
        const hasLinkedAccount = Boolean(
            effectiveAccountId &&
            effectiveAccountId !== this.user.id &&
            members.some(m => m.userId === effectiveAccountId)
        );

        if (!hasLinkedAccount) {
            const currentUserMember = members.find(m => m.email === this.user.email || m.userId === this.user.id);
            if (currentUserMember && currentUserMember.userId !== this.user.id) {
                await this.repo.migrateUser(currentUserMember.userId, this.user.id, this.user.name);
                
                // Apply migration to the loaded in-memory data
                expenses.forEach(e => {
                    if (e.paidByUserId === currentUserMember.userId) e.paidByUserId = this.user.id;
                    e.splits?.forEach(s => {
                        if (s.userId === currentUserMember.userId) s.userId = this.user.id;
                    });
                });
                settlements.forEach(s => {
                    if (s.fromUserId === currentUserMember.userId) s.fromUserId = this.user.id;
                    if (s.toUserId === currentUserMember.userId) s.toUserId = this.user.id;
                });
                currentUserMember.userId = this.user.id;
            }
        }

        return new Ledger({ expenses, settlements, members, categories });
    }
}
