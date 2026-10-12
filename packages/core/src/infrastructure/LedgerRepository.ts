import { IStorageLayer } from "./IStorageLayer";
import { Expense, Settlement, Member } from "../domain/models";
import { ConflictError } from "../errors";
import { SheetDataMapper, HeaderMap, DEFAULT_EXPENSE_MAP, DEFAULT_SETTLEMENT_MAP, DEFAULT_MEMBER_MAP } from "./SheetDataMapper";
import type { QuozenDatabase } from "../db";
import {
    expenseToDoc,
    docToExpense,
    settlementToDoc,
    docToSettlement,
    memberToDoc,
    docToMember
} from "../db/schemas";
import { map, type Observable, of } from "rxjs";
import { ReplicationCoordinator } from "../sync/ReplicationCoordinator";

export class LedgerRepository {
    private expenseRowMap = new Map<string, number>();
    private settlementRowMap = new Map<string, number>();
    private memberRowMap = new Map<string, number>();

    private expenseHeaderMap: HeaderMap = DEFAULT_EXPENSE_MAP;
    private settlementHeaderMap: HeaderMap = DEFAULT_SETTLEMENT_MAP;
    private memberHeaderMap: HeaderMap = DEFAULT_MEMBER_MAP;

    private static hydrationPromises = new WeakMap<object, Map<string, Promise<void>>>();

    constructor(
        private storage?: IStorageLayer,
        private groupId: string = "",
        private db?: QuozenDatabase,
        private onMutation?: () => void
    ) {}

    public hasLocalDb(): boolean {
        return Boolean(this.db);
    }

    private notifyMutation(): void {
        if (this.onMutation) {
            try {
                this.onMutation();
            } catch {
                // Ignore background sync trigger errors
            }
        }
    }

    private async hydrateFromStorageIfNeeded(): Promise<void> {
        if (!this.db || !this.storage || !this.groupId) return;

        let groupMap = LedgerRepository.hydrationPromises.get(this.db);
        if (!groupMap) {
            groupMap = new Map<string, Promise<void>>();
            LedgerRepository.hydrationPromises.set(this.db, groupMap);
        }

        const existingPromise = groupMap.get(this.groupId);
        if (existingPromise) {
            await existingPromise;
            return;
        }

        const promise = this.performHydration();
        groupMap.set(this.groupId, promise);
        await promise;
    }

    private async performHydration(): Promise<void> {
        if (!this.db || !this.storage || !this.groupId) return;

        try {
            const [existingMembers, existingExpenses, existingSettlements] = await Promise.all([
                this.db.members.find({ selector: { groupId: this.groupId } }).exec(),
                this.db.expenses.find({ selector: { groupId: this.groupId } }).exec(),
                this.db.settlements.find({ selector: { groupId: this.groupId } }).exec()
            ]);

            if (existingMembers.length === 0 && existingExpenses.length === 0 && existingSettlements.length === 0) {
                const res = await this.storage.batchGetValues(this.groupId, [
                    "Members!A1:Z",
                    "Expenses!A1:Z",
                    "Settlements!A1:Z"
                ]);

                const nonEmptyRow = (r: any[]) =>
                    Array.isArray(r) && r.some(cell => String(cell ?? "").trim() !== "");

                const memberRows = res[0]?.values || [];
                if (memberRows.length > 1) {
                    const mHeaders = SheetDataMapper.buildHeaderMap(memberRows[0]);
                    const mDocs = memberRows
                        .slice(1)
                        .filter(nonEmptyRow)
                        .map((r: any[], i: number) =>
                            memberToDoc(SheetDataMapper.mapToMember(r, i + 2, mHeaders).entity, this.groupId)
                        )
                        .filter((d: any) => Boolean(d.userId));
                    if (mDocs.length > 0) {
                        await this.db.members.bulkUpsert(mDocs);
                        ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, mDocs);
                    }
                }

                const expenseRows = res[1]?.values || [];
                if (expenseRows.length > 1) {
                    const eHeaders = SheetDataMapper.buildHeaderMap(expenseRows[0]);
                    const eDocs = expenseRows
                        .slice(1)
                        .filter(nonEmptyRow)
                        .map((r: any[], i: number) =>
                            expenseToDoc(SheetDataMapper.mapToExpense(r, i + 2, eHeaders).entity, this.groupId)
                        )
                        .filter((d: any) => Boolean(d.id));
                    if (eDocs.length > 0) {
                        await this.db.expenses.bulkUpsert(eDocs);
                        ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, eDocs);
                    }
                }

                const settlementRows = res[2]?.values || [];
                if (settlementRows.length > 1) {
                    const sHeaders = SheetDataMapper.buildHeaderMap(settlementRows[0]);
                    const sDocs = settlementRows
                        .slice(1)
                        .filter(nonEmptyRow)
                        .map((r: any[], i: number) =>
                            settlementToDoc(SheetDataMapper.mapToSettlement(r, i + 2, sHeaders).entity, this.groupId)
                        )
                        .filter((d: any) => Boolean(d.id));
                    if (sDocs.length > 0) {
                        await this.db.settlements.bulkUpsert(sDocs);
                        ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, sDocs);
                    }
                }
            }
        } catch {
            // Ignore hydration error if offline or group not yet created in remote storage
        }
    }

    private async touchGroup() {
        if (!this.storage) return;
        await this.storage.updateFile(this.groupId, { properties: { _lastSyncTrigger: new Date().toISOString() } }).catch(() => {});
    }

    public observeExpenses(): Observable<Expense[]> {
        if (!this.db) return of([]);
        return this.db.expenses
            .find({ selector: { groupId: this.groupId } })
            .$.pipe(
                map(docs =>
                    docs
                        .map(d => d.toJSON())
                        .filter(d => !d.deletedAt)
                        .map(d => docToExpense(d))
                )
            );
    }

    public observeSettlements(): Observable<Settlement[]> {
        if (!this.db) return of([]);
        return this.db.settlements
            .find({ selector: { groupId: this.groupId } })
            .$.pipe(
                map(docs =>
                    docs
                        .map(d => d.toJSON())
                        .filter(d => !d.deletedAt)
                        .map(d => docToSettlement(d))
                )
            );
    }

    public observeMembers(): Observable<Member[]> {
        if (!this.db) return of([]);
        return this.db.members
            .find({ selector: { groupId: this.groupId } })
            .$.pipe(
                map(docs =>
                    docs
                        .map(d => d.toJSON())
                        .filter(d => !d.deletedAt)
                        .map(d => docToMember(d))
                )
            );
    }

    async getMembers(): Promise<Member[]> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const docs = await this.db.members.find({ selector: { groupId: this.groupId } }).exec();
            return docs
                .map(d => d.toJSON())
                .filter(d => !d.deletedAt)
                .map(d => docToMember(d));
        }

        if (!this.storage) return [];
        const res = await this.storage.batchGetValues(this.groupId, ["Members!A1:Z"]);
        const rows = res[0]?.values || [];
        if (rows.length === 0) return [];

        const headers = rows[0].map((h: any) => String(h).trim());
        this.memberHeaderMap = SheetDataMapper.buildHeaderMap(headers);

        return rows.slice(1).map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToMember(r, i + 2, this.memberHeaderMap);
            this.memberRowMap.set(mapped.entity.userId, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async getExpenses(): Promise<Expense[]> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const docs = await this.db.expenses.find({ selector: { groupId: this.groupId } }).exec();
            return docs
                .map(d => d.toJSON())
                .filter(d => !d.deletedAt)
                .map(d => docToExpense(d));
        }

        if (!this.storage) return [];
        const res = await this.storage.batchGetValues(this.groupId, ["Expenses!A1:Z"]);
        const rows = res[0]?.values || [];
        if (rows.length === 0) return [];

        const headers = rows[0].map((h: any) => String(h).trim());
        this.expenseHeaderMap = SheetDataMapper.buildHeaderMap(headers);

        return rows.slice(1).map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToExpense(r, i + 2, this.expenseHeaderMap);
            this.expenseRowMap.set(mapped.entity.id, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async getSettlements(): Promise<Settlement[]> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const docs = await this.db.settlements.find({ selector: { groupId: this.groupId } }).exec();
            return docs
                .map(d => d.toJSON())
                .filter(d => !d.deletedAt)
                .map(d => docToSettlement(d));
        }

        if (!this.storage) return [];
        const res = await this.storage.batchGetValues(this.groupId, ["Settlements!A1:Z"]);
        const rows = res[0]?.values || [];
        if (rows.length === 0) return [];

        const headers = rows[0].map((h: any) => String(h).trim());
        this.settlementHeaderMap = SheetDataMapper.buildHeaderMap(headers);

        return rows.slice(1).map((r: any[], i: number) => {
            const mapped = SheetDataMapper.mapToSettlement(r, i + 2, this.settlementHeaderMap);
            this.settlementRowMap.set(mapped.entity.id, mapped.rowIndex);
            return mapped.entity;
        });
    }

    async addExpense(expense: Expense): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            await this.db.expenses.upsert(expenseToDoc(expense, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (Object.keys(this.expenseHeaderMap).length === 0 || this.expenseHeaderMap === DEFAULT_EXPENSE_MAP) await this.getExpenses();
        const row = SheetDataMapper.mapFromExpense(expense, this.expenseHeaderMap);
        await this.storage.appendValues(this.groupId, "Expenses!A1", [row]);
        await this.touchGroup();
    }

    async updateExpense(expense: Expense, expectedLastModified?: Date): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const existing = await this.db.expenses.findOne(expense.id).exec();
            if (!existing || existing.deletedAt) throw new Error("Expense not found");

            if (
                expectedLastModified &&
                new Date(existing.updatedAt).getTime() > expectedLastModified.getTime()
            ) {
                throw new ConflictError("Data has been modified by another user.");
            }

            if (
                this.storage &&
                (typeof globalThis === "undefined" || (globalThis as any).navigator?.onLine !== false)
            ) {
                try {
                    const res = await this.storage.batchGetValues(this.groupId, ["Expenses!A1:Z"]);
                    const rows = res[0]?.values || [];
                    if (rows.length > 1) {
                        const headers = rows[0].map((h: any) => String(h).trim());
                        const headerMap = SheetDataMapper.buildHeaderMap(headers);
                        for (let i = 1; i < rows.length; i++) {
                            const mapped = SheetDataMapper.mapToExpense(rows[i], i + 1, headerMap);
                            if (mapped.entity.id === expense.id) {
                                if (
                                    expectedLastModified &&
                                    mapped.entity.updatedAt.getTime() > expectedLastModified.getTime()
                                ) {
                                    const remoteDoc = expenseToDoc(mapped.entity, this.groupId);
                                    await this.db.expenses.upsert(remoteDoc);
                                    ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [remoteDoc]);
                                    throw new ConflictError("Data has been modified by another user.");
                                }
                                break;
                            }
                        }
                    }
                } catch (err: any) {
                    if (
                        err instanceof ConflictError ||
                        err?.name === "ConflictError" ||
                        String(err?.message || "").includes("409") ||
                        String(err?.message || "").toLowerCase().includes("conflict")
                    ) {
                        throw err instanceof ConflictError
                            ? err
                            : new ConflictError(err?.message || "Data has been modified by another user.");
                    }
                    // Ignore transient network errors when offline so local RxDB update still succeeds
                }
            }

            await this.db.expenses.upsert(expenseToDoc(expense, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (!this.expenseRowMap.has(expense.id)) {
            await this.getExpenses();
        }
        const rowIndex = this.expenseRowMap.get(expense.id);
        if (!rowIndex) throw new Error("Expense not found");

        const row = SheetDataMapper.mapFromExpense(expense, this.expenseHeaderMap);
        await this.storage.updateValues(this.groupId, `Expenses!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteExpense(expenseId: string): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const existing = await this.db.expenses.findOne(expenseId).exec();
            if (!existing || existing.deletedAt) throw new Error("Expense not found");
            const nowIso = new Date().toISOString();
            await existing.patch({ deletedAt: nowIso, updatedAt: nowIso });
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
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
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            await this.db.settlements.upsert(settlementToDoc(settlement, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (Object.keys(this.settlementHeaderMap).length === 0 || this.settlementHeaderMap === DEFAULT_SETTLEMENT_MAP) await this.getSettlements();
        const row = SheetDataMapper.mapFromSettlement(settlement, this.settlementHeaderMap);
        await this.storage.appendValues(this.groupId, "Settlements!A1", [row]);
        await this.touchGroup();
    }

    async updateSettlement(settlement: Settlement): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const existing = await this.db.settlements.findOne(settlement.id).exec();
            if (!existing || existing.deletedAt) throw new Error("Settlement not found");
            await this.db.settlements.upsert(settlementToDoc({ ...settlement, updatedAt: new Date() }, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (!this.settlementRowMap.has(settlement.id)) {
            await this.getSettlements();
        }
        const rowIndex = this.settlementRowMap.get(settlement.id);
        if (!rowIndex) throw new Error("Settlement not found");

        const row = SheetDataMapper.mapFromSettlement(settlement, this.settlementHeaderMap);
        await this.storage.updateValues(this.groupId, `Settlements!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteSettlement(settlementId: string): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const existing = await this.db.settlements.findOne(settlementId).exec();
            if (!existing || existing.deletedAt) throw new Error("Settlement not found");
            const nowIso = new Date().toISOString();
            await existing.patch({ deletedAt: nowIso, updatedAt: nowIso });
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
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
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            await this.db.members.upsert(memberToDoc(member, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (Object.keys(this.memberHeaderMap).length === 0 || this.memberHeaderMap === DEFAULT_MEMBER_MAP) await this.getMembers();
        const row = SheetDataMapper.mapFromMember(member, this.memberHeaderMap);
        await this.storage.appendValues(this.groupId, "Members!A1", [row]);
        await this.touchGroup();
    }

    async updateMember(member: Member): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const docId = `${this.groupId}_${member.userId}`;
            const existing = await this.db.members.findOne(docId).exec();
            if (!existing || existing.deletedAt) throw new Error("Member not found");
            await this.db.members.upsert(memberToDoc({ ...member, updatedAt: new Date() }, this.groupId));
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
        if (!this.memberRowMap.has(member.userId)) {
            await this.getMembers();
        }
        const rowIndex = this.memberRowMap.get(member.userId);
        if (!rowIndex) throw new Error("Member not found");

        const row = SheetDataMapper.mapFromMember(member, this.memberHeaderMap);
        await this.storage.updateValues(this.groupId, `Members!A${rowIndex}:Z${rowIndex}`, [row]);
        await this.touchGroup();
    }

    async deleteMember(userId: string): Promise<void> {
        if (this.db) {
            await this.hydrateFromStorageIfNeeded();
            const docId = `${this.groupId}_${userId}`;
            const existing = await this.db.members.findOne(docId).exec();
            if (!existing || existing.deletedAt) throw new Error("Member not found");
            const nowIso = new Date().toISOString();
            await existing.patch({ deletedAt: nowIso, updatedAt: nowIso });
            this.notifyMutation();
            return;
        }

        if (!this.storage) return;
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
        if (this.db) {
            const members = await this.getMembers();
            const member = members.find(m => m.userId === oldUserId);
            if (member) {
                await this.deleteMember(oldUserId);
                await this.addMember({
                    ...member,
                    userId: newUserId,
                    name: newName || member.name,
                    updatedAt: new Date()
                });
            }

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
                    expense.updatedAt = new Date();
                    await this.updateExpense(expense);
                }
            }

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
                    settlement.updatedAt = new Date();
                    await this.updateSettlement(settlement);
                }
            }
            return;
        }

        // 1. Members
        const members = await this.getMembers();
        const member = members.find(m => m.userId === oldUserId);
        if (member) {
            member.userId = newUserId;
            if (newName) member.name = newName;
            
            const rowIndex = this.memberRowMap.get(oldUserId);
            if (rowIndex && this.storage) {
                const row = SheetDataMapper.mapFromMember(member, this.memberHeaderMap);
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
