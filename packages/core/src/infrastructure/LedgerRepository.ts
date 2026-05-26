import { IStorageLayer } from "./IStorageLayer";
import { Expense, Settlement, Member } from "../domain/models";
import { SheetDataMapper } from "./SheetDataMapper";

export class LedgerRepository {
    private expenseRowMap = new Map<string, number>();
    private settlementRowMap = new Map<string, number>();
    private memberRowMap = new Map<string, number>();

    constructor(private storage: IStorageLayer, private groupId: string) { }

    private async touchGroup() {
        await this.storage.updateFile(this.groupId, { properties: { _lastSyncTrigger: new Date().toISOString() } });
    }

    async getMembers(): Promise<Member[]> {
        const res = await this.storage.batchGetValues(this.groupId, ["Members!A2:Z"]);
        const rows = res[0]?.values || [];
        return rows.map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToMember(r, i + 2);
            this.memberRowMap.set(mapped.entity.userId, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async getExpenses(): Promise<Expense[]> {
        const res = await this.storage.batchGetValues(this.groupId, ["Expenses!A2:Z"]);
        const rows = res[0]?.values || [];
        return rows.map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToExpense(r, i + 2);
            this.expenseRowMap.set(mapped.entity.id, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async getSettlements(): Promise<Settlement[]> {
        const res = await this.storage.batchGetValues(this.groupId, ["Settlements!A2:Z"]);
        const rows = res[0]?.values || [];
        return rows.map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToSettlement(r, i + 2);
            this.settlementRowMap.set(mapped.entity.id, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async addExpense(expense: Expense): Promise<void> {
        const row = SheetDataMapper.mapFromExpense(expense);
        await this.storage.appendValues(this.groupId, "Expenses!A1", [row]);
        await this.touchGroup();
    }

    async updateExpense(expense: Expense, _expectedLastModified?: Date): Promise<void> {
        if (!this.expenseRowMap.has(expense.id)) {
            await this.getExpenses();
        }
        const rowIndex = this.expenseRowMap.get(expense.id);
        if (!rowIndex) throw new Error("Expense not found");

        const row = SheetDataMapper.mapFromExpense(expense);
        await this.storage.updateValues(this.groupId, `Expenses!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteExpense(expenseId: string): Promise<void> {
        if (!this.expenseRowMap.has(expenseId)) {
            await this.getExpenses();
        }
        const rowIndex = this.expenseRowMap.get(expenseId);
        if (!rowIndex) throw new Error("Expense not found");

        const sheetData = await this.storage.getSpreadsheet(this.groupId, "sheets.properties");
        const sheetId = sheetData.sheets.find((s: any) => s.properties.title === "Expenses")?.properties?.sheetId;
        if (sheetId === undefined) throw new Error("Sheet Expenses not found");

        await this.storage.batchUpdateSpreadsheet(this.groupId, [
            { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex } } }
        ]);
        await this.touchGroup();
    }

    async addSettlement(settlement: Settlement): Promise<void> {
        const row = SheetDataMapper.mapFromSettlement(settlement);
        await this.storage.appendValues(this.groupId, "Settlements!A1", [row]);
        await this.touchGroup();
    }

    async updateSettlement(settlement: Settlement): Promise<void> {
        if (!this.settlementRowMap.has(settlement.id)) {
            await this.getSettlements();
        }
        const rowIndex = this.settlementRowMap.get(settlement.id);
        if (!rowIndex) throw new Error("Settlement not found");

        const row = SheetDataMapper.mapFromSettlement(settlement);
        await this.storage.updateValues(this.groupId, `Settlements!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteSettlement(settlementId: string): Promise<void> {
        if (!this.settlementRowMap.has(settlementId)) {
            await this.getSettlements();
        }
        const rowIndex = this.settlementRowMap.get(settlementId);
        if (!rowIndex) throw new Error("Settlement not found");

        const sheetData = await this.storage.getSpreadsheet(this.groupId, "sheets.properties");
        const sheetId = sheetData.sheets.find((s: any) => s.properties.title === "Settlements")?.properties?.sheetId;
        if (sheetId === undefined) throw new Error("Sheet Settlements not found");

        await this.storage.batchUpdateSpreadsheet(this.groupId, [
            { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex } } }
        ]);
        await this.touchGroup();
    }

    async addMember(member: Member): Promise<void> {
        const row = SheetDataMapper.mapFromMember(member);
        await this.storage.appendValues(this.groupId, "Members!A1", [row]);
        await this.touchGroup();
    }

    async updateMember(member: Member): Promise<void> {
        if (!this.memberRowMap.has(member.userId)) {
            await this.getMembers();
        }
        const rowIndex = this.memberRowMap.get(member.userId);
        if (!rowIndex) throw new Error("Member not found");

        const row = SheetDataMapper.mapFromMember(member);
        await this.storage.updateValues(this.groupId, `Members!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteMember(userId: string): Promise<void> {
        if (!this.memberRowMap.has(userId)) {
            await this.getMembers();
        }
        const rowIndex = this.memberRowMap.get(userId);
        if (!rowIndex) throw new Error("Member not found");

        const sheetData = await this.storage.getSpreadsheet(this.groupId, "sheets.properties");
        const sheetId = sheetData.sheets.find((s: any) => s.properties.title === "Members")?.properties?.sheetId;
        if (sheetId === undefined) throw new Error("Sheet Members not found");

        await this.storage.batchUpdateSpreadsheet(this.groupId, [
            { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex } } }
        ]);
        await this.touchGroup();
    }

    async migrateUser(oldUserId: string, newUserId: string, newName?: string): Promise<void> {
        // 1. Members
        const members = await this.getMembers();
        const member = members.find(m => m.userId === oldUserId);
        if (member) {
            member.userId = newUserId;
            if (newName) member.name = newName;
            
            const rowIndex = this.memberRowMap.get(oldUserId);
            if (rowIndex) {
                const row = SheetDataMapper.mapFromMember(member);
                await this.storage.updateValues(this.groupId, `Members!A${rowIndex}:Z${rowIndex}`, [row]);
                this.memberRowMap.delete(oldUserId);
                this.memberRowMap.set(newUserId, rowIndex);
            }
        }

        // 2. Expenses
        const expenses = await this.getExpenses();
        for (const expense of expenses) {
            let changed = false;
            if (expense.paidByUserId === oldUserId) {
                expense.paidByUserId = newUserId;
                changed = true;
            }
            if (expense.splits) {
                for (const split of expense.splits) {
                    if (split.userId === oldUserId) {
                        split.userId = newUserId;
                        changed = true;
                    }
                }
            }
            if (changed) {
                await this.updateExpense(expense);
            }
        }

        // 3. Settlements
        const settlements = await this.getSettlements();
        for (const settlement of settlements) {
            let changed = false;
            if (settlement.fromUserId === oldUserId) {
                settlement.fromUserId = newUserId;
                changed = true;
            }
            if (settlement.toUserId === oldUserId) {
                settlement.toUserId = newUserId;
                changed = true;
            }
            if (changed) {
                await this.updateSettlement(settlement);
            }
        }
    }
}
