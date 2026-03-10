import { LedgerRepository } from "../infrastructure/LedgerRepository";
import { User, Expense, Settlement } from "../domain/models";
import { CreateExpenseDTO, UpdateExpenseDTO, CreateSettlementDTO, UpdateSettlementDTO } from "../domain/dtos";
import { Ledger } from "../domain/Ledger";
import { ConflictError } from "../errors";
import { distributeAmount } from "./index";

export class LedgerService {
    constructor(private repo: LedgerRepository, private user: User) { }

    async getExpenses(): Promise<Expense[]> {
        return this.repo.getExpenses();
    }

    async addExpense(payload: CreateExpenseDTO): Promise<Expense> {
        const members = await this.repo.getMembers();
        const isMember = members.some(m => m.userId === this.user.id || m.email === this.user.email);
        if (!isMember) throw new Error("Forbidden: User is not a member of this group");

        let splits = payload.splits || [];
        if (splits.length === 0 && members.length > 0) {
            const amounts = distributeAmount(payload.amount, members.length);
            splits = members.map((m, i) => ({ userId: m.userId, amount: amounts[i] }));
        }

        // Validate splits mismatch
        const splitSum = splits.reduce((sum, s) => sum + s.amount, 0);
        if (Math.abs(splitSum - payload.amount) > 0.01) {
            throw new Error("Splits mismatch");
        }

        const expense: Expense = {
            id: (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString()),
            description: payload.description,
            amount: payload.amount,
            category: payload.category,
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
        const expenses = await this.repo.getExpenses();
        const current = expenses.find(e => e.id === expenseId);
        if (!current) throw new Error("Expense not found");

        if (expectedLastModified && current.updatedAt.getTime() > expectedLastModified.getTime()) {
            throw new ConflictError("Data has been modified by another user.");
        }

        // Validate splits mismatch if amount or splits are updated
        const newAmount = payload.amount ?? current.amount;
        const newSplits = payload.splits ?? current.splits;
        const splitSum = newSplits.reduce((sum, s) => sum + s.amount, 0);
        if (Math.abs(splitSum - newAmount) > 0.01) {
            throw new Error("Splits mismatch");
        }

        const updated: Expense = {
            ...current,
            description: payload.description ?? current.description,
            amount: payload.amount ?? current.amount,
            category: payload.category ?? current.category,
            date: payload.date ? new Date(payload.date) : current.date,
            paidByUserId: payload.paidByUserId ?? current.paidByUserId,
            splits: payload.splits ?? current.splits,
            updatedAt: new Date()
        };

        await this.repo.updateExpense(updated);
    }

    async deleteExpense(expenseId: string): Promise<void> {
        await this.repo.deleteExpense(expenseId);
    }

    async getSettlements(): Promise<Settlement[]> {
        return this.repo.getSettlements();
    }

    async addSettlement(payload: CreateSettlementDTO): Promise<Settlement> {
        const settlement: Settlement = {
            id: (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString()),
            date: payload.date || new Date(),
            fromUserId: payload.fromUserId,
            toUserId: payload.toUserId,
            amount: payload.amount,
            method: payload.method || 'cash',
            notes: payload.notes
        };
        await this.repo.addSettlement(settlement);
        return settlement;
    }

    async updateSettlement(settlementId: string, payload: UpdateSettlementDTO): Promise<void> {
        const settlements = await this.repo.getSettlements();
        const current = settlements.find(s => s.id === settlementId);
        if (!current) throw new Error("Settlement not found");

        const updated: Settlement = {
            ...current,
            date: payload.date ?? current.date,
            fromUserId: payload.fromUserId ?? current.fromUserId,
            toUserId: payload.toUserId ?? current.toUserId,
            amount: payload.amount ?? current.amount,
            method: payload.method ?? current.method,
            notes: payload.notes ?? current.notes
        };

        await this.repo.updateSettlement(updated);
    }

    async deleteSettlement(settlementId: string): Promise<void> {
        await this.repo.deleteSettlement(settlementId);
    }

    async getMembers() {
        return this.repo.getMembers();
    }

    async getLedger(): Promise<Ledger> {
        const expenses = await this.repo.getExpenses();
        const settlements = await this.repo.getSettlements();
        const members = await this.repo.getMembers();

        return new Ledger({ expenses, settlements, members });
    }
}
