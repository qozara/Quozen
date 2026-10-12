import { Expense, Settlement, Member, ExpenseSplit } from "../domain/models";

export interface SheetRow<T> {
    entity: T;
    rowIndex: number;
}

export const SCHEMAS = {
    EXPENSES: 'Expenses!A:Z',
    SETTLEMENTS: 'Settlements!A:Z',
    GROUPS: 'Groups!A:Z',
    METADATA: 'Metadata!A:B'
};

export type HeaderMap = Record<string, number>;

export const DEFAULT_EXPENSE_MAP: HeaderMap = { id: 0, date: 1, description: 2, amount: 3, paidBy: 4, category: 5, splits: 6, meta: 7 };
export const DEFAULT_SETTLEMENT_MAP: HeaderMap = { id: 0, date: 1, fromUserId: 2, toUserId: 3, amount: 4, method: 5, notes: 6 };
export const DEFAULT_MEMBER_MAP: HeaderMap = { userId: 0, email: 1, name: 2, role: 3, joinedAt: 4 };


function getHeaderIndex(headerMap: HeaderMap, key: string, fallbackIndex?: number): number | undefined {
    if (key in headerMap) return headerMap[key];
    const lowerKey = key.toLowerCase();
    for (const [k, idx] of Object.entries(headerMap)) {
        if (k.trim().toLowerCase() === lowerKey) {
            return idx;
        }
    }
    return fallbackIndex;
}

export class SheetDataMapper {
    static buildHeaderMap(headers: any[]): HeaderMap {
        return headers.reduce((acc: HeaderMap, h: any, i: number) => {
            const trimmed = String(h ?? "").trim();
            if (trimmed) {
                acc[trimmed] = i;
            }
            return acc;
        }, {} as HeaderMap);
    }

    static mapToExpense(row: any[], rowIndex: number, headerMap: HeaderMap = DEFAULT_EXPENSE_MAP): SheetRow<Expense> {
        const idIdx = getHeaderIndex(headerMap, 'id', 0)!;
        const dateIdx = getHeaderIndex(headerMap, 'date', 1)!;
        const descIdx = getHeaderIndex(headerMap, 'description', 2)!;
        const amountIdx = getHeaderIndex(headerMap, 'amount', 3)!;
        const paidByIdx = getHeaderIndex(headerMap, 'paidBy', 4) ?? getHeaderIndex(headerMap, 'paidByUserId', 4)!;
        const catIdx = getHeaderIndex(headerMap, 'category', 5)!;
        const splitsIdx = getHeaderIndex(headerMap, 'splits', 6)!;
        const metaIdx = getHeaderIndex(headerMap, 'meta');
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');

        const id = row[idIdx];
        const date = row[dateIdx];
        const description = row[descIdx];
        const amountRaw = row[amountIdx];
        const paidByUserId = row[paidByIdx];
        const category = row[catIdx];
        const splitsRaw = row[splitsIdx];
        const metaRaw = metaIdx !== undefined ? row[metaIdx] : row[7];
        const updatedAtCol = updatedAtIdx !== undefined ? row[updatedAtIdx] : undefined;
        const deletedAtCol = deletedAtIdx !== undefined ? row[deletedAtIdx] : undefined;

        let splits: ExpenseSplit[] = [];
        try {
            splits = typeof splitsRaw === 'string' ? JSON.parse(splitsRaw) : (splitsRaw || []);
        } catch {
            splits = [];
        }

        let meta: any = {};
        try {
            meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : (metaRaw || {});
        } catch {
            meta = {};
        }

        let amount = 0;
        if (amountRaw !== undefined && amountRaw !== null && amountRaw !== "") {
            amount = typeof amountRaw === 'string' ? parseFloat(amountRaw.replace(',', '.')) : parseFloat(String(amountRaw));
        }
        if (isNaN(amount)) amount = 0;

        const parsedDate = date ? new Date(date) : new Date(0);
        const createdAt = meta.createdAt ? new Date(meta.createdAt) : parsedDate;
        const updatedAt = updatedAtCol
            ? new Date(updatedAtCol)
            : meta.lastModified
                ? new Date(meta.lastModified)
                : parsedDate;

        const expense: Expense = {
            id: id || "",
            date: parsedDate,
            description: description || "",
            amount,
            paidByUserId: paidByUserId || "",
            category: category || "",
            splits,
            createdAt,
            updatedAt,
        };

        const rawDeleted = deletedAtCol || meta.deletedAt;
        if (rawDeleted) {
            expense.deletedAt = new Date(rawDeleted);
        }

        return { entity: expense, rowIndex };
    }

    static mapFromExpense(expense: Expense, headerMap: HeaderMap = DEFAULT_EXPENSE_MAP): any[] {
        let maxIdx = 0;
        for (const idx of Object.values(headerMap)) {
            if (idx > maxIdx) maxIdx = idx;
        }
        const row = new Array(maxIdx + 1).fill("");

        const setCol = (key: string, val: any) => {
            const idx = getHeaderIndex(headerMap, key);
            if (idx !== undefined) row[idx] = val;
        };

        const dateIso = expense.date instanceof Date ? expense.date.toISOString() : new Date(expense.date).toISOString();
        const createdIso = expense.createdAt instanceof Date ? expense.createdAt.toISOString() : new Date(expense.createdAt || dateIso).toISOString();
        const updatedIso = expense.updatedAt instanceof Date ? expense.updatedAt.toISOString() : new Date(expense.updatedAt || dateIso).toISOString();
        const deletedIso = expense.deletedAt ? (expense.deletedAt instanceof Date ? expense.deletedAt.toISOString() : new Date(expense.deletedAt).toISOString()) : undefined;

        setCol('id', expense.id);
        setCol('date', dateIso);
        setCol('description', expense.description);
        setCol('amount', expense.amount);
        setCol('paidBy', expense.paidByUserId);
        setCol('category', expense.category);
        setCol('splits', JSON.stringify(expense.splits));
        setCol('meta', JSON.stringify({
            createdAt: createdIso,
            lastModified: updatedIso,
            ...(deletedIso ? { deletedAt: deletedIso } : {})
        }));
        setCol('updatedAt', updatedIso);
        if (deletedIso) setCol('deletedAt', deletedIso);

        return row;
    }

    static mapToSettlement(row: any[], rowIndex: number, headerMap: HeaderMap = DEFAULT_SETTLEMENT_MAP): SheetRow<Settlement> {
        const id = row[getHeaderIndex(headerMap, 'id', 0)!];
        const date = row[getHeaderIndex(headerMap, 'date', 1)!];
        const fromUserId = row[getHeaderIndex(headerMap, 'fromUserId', 2)!];
        const toUserId = row[getHeaderIndex(headerMap, 'toUserId', 3)!];
        const amountRaw = row[getHeaderIndex(headerMap, 'amount', 4)!];
        const method = row[getHeaderIndex(headerMap, 'method', 5)!];
        const notes = row[getHeaderIndex(headerMap, 'notes', 6)!];
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');
        const updatedAtCol = updatedAtIdx !== undefined ? row[updatedAtIdx] : undefined;
        const deletedAtCol = deletedAtIdx !== undefined ? row[deletedAtIdx] : undefined;

        let amount = 0;
        if (amountRaw !== undefined && amountRaw !== null && amountRaw !== "") {
            amount = typeof amountRaw === 'string' ? parseFloat(amountRaw.replace(',', '.')) : parseFloat(String(amountRaw));
        }
        if (isNaN(amount)) amount = 0;

        const parsedDate = date ? new Date(date) : new Date(0);
        const updatedAt = updatedAtCol ? new Date(updatedAtCol) : parsedDate;

        const settlement: Settlement = {
            id: id || "",
            date: parsedDate,
            fromUserId: fromUserId || "",
            toUserId: toUserId || "",
            amount,
            method: method || "cash",
            notes: notes || "",
            updatedAt
        };

        if (deletedAtCol) {
            settlement.deletedAt = new Date(deletedAtCol);
        }

        return { entity: settlement, rowIndex };
    }

    static mapFromSettlement(settlement: Settlement, headerMap: HeaderMap = DEFAULT_SETTLEMENT_MAP): any[] {
        let maxIdx = 0;
        for (const idx of Object.values(headerMap)) {
            if (idx > maxIdx) maxIdx = idx;
        }
        const row = new Array(maxIdx + 1).fill("");

        const setCol = (key: string, val: any) => {
            const idx = getHeaderIndex(headerMap, key);
            if (idx !== undefined) row[idx] = val;
        };

        const dateIso = settlement.date instanceof Date ? settlement.date.toISOString() : new Date(settlement.date).toISOString();
        const updatedIso = settlement.updatedAt
            ? (settlement.updatedAt instanceof Date ? settlement.updatedAt.toISOString() : new Date(settlement.updatedAt).toISOString())
            : dateIso;

        setCol('id', settlement.id);
        setCol('date', dateIso);
        setCol('fromUserId', settlement.fromUserId);
        setCol('toUserId', settlement.toUserId);
        setCol('amount', settlement.amount);
        setCol('method', settlement.method);
        setCol('notes', settlement.notes || "");
        setCol('updatedAt', updatedIso);
        if (settlement.deletedAt) {
            setCol('deletedAt', settlement.deletedAt instanceof Date ? settlement.deletedAt.toISOString() : new Date(settlement.deletedAt).toISOString());
        }

        return row;
    }

    static mapToMember(row: any[], rowIndex: number, headerMap: HeaderMap = DEFAULT_MEMBER_MAP): SheetRow<Member> {
        const userId = row[getHeaderIndex(headerMap, 'userId', 0)!];
        const email = row[getHeaderIndex(headerMap, 'email', 1)!];
        const name = row[getHeaderIndex(headerMap, 'name', 2)!];
        const role = row[getHeaderIndex(headerMap, 'role', 3)!];
        const joinedAt = row[getHeaderIndex(headerMap, 'joinedAt', 4)!];
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');
        const updatedAtCol = updatedAtIdx !== undefined ? row[updatedAtIdx] : undefined;
        const deletedAtCol = deletedAtIdx !== undefined ? row[deletedAtIdx] : undefined;

        const parsedJoinedAt = joinedAt ? new Date(joinedAt) : new Date(0);
        const updatedAt = updatedAtCol ? new Date(updatedAtCol) : parsedJoinedAt;

        const member: Member = {
            userId: userId || "",
            email: email || "",
            name: name || "",
            role: (role === "owner" || role === "member") ? role : "member",
            joinedAt: parsedJoinedAt,
            updatedAt
        };

        if (deletedAtCol) {
            member.deletedAt = new Date(deletedAtCol);
        }

        return { entity: member, rowIndex };
    }

    static mapFromMember(member: Member, headerMap: HeaderMap = DEFAULT_MEMBER_MAP): any[] {
        let maxIdx = 0;
        for (const idx of Object.values(headerMap)) {
            if (idx > maxIdx) maxIdx = idx;
        }
        const row = new Array(maxIdx + 1).fill("");

        const setCol = (key: string, val: any) => {
            const idx = getHeaderIndex(headerMap, key);
            if (idx !== undefined) row[idx] = val;
        };

        const joinedIso = member.joinedAt instanceof Date ? member.joinedAt.toISOString() : new Date(member.joinedAt).toISOString();
        const updatedIso = member.updatedAt
            ? (member.updatedAt instanceof Date ? member.updatedAt.toISOString() : new Date(member.updatedAt).toISOString())
            : joinedIso;

        setCol('userId', member.userId);
        setCol('email', member.email);
        setCol('name', member.name);
        setCol('role', member.role);
        setCol('joinedAt', joinedIso);
        setCol('updatedAt', updatedIso);
        if (member.deletedAt) {
            setCol('deletedAt', member.deletedAt instanceof Date ? member.deletedAt.toISOString() : new Date(member.deletedAt).toISOString());
        }

        return row;
    }
}
