import { Expense, Settlement, Member, ExpenseSplit, ExpenseCategory } from "../domain/models";

export interface SheetRow<T> {
    entity: T;
    rowIndex: number;
}

export const SCHEMAS = {
    EXPENSES: 'Expenses!A:Z',
    SETTLEMENTS: 'Settlements!A:Z',
    GROUPS: 'Groups!A:Z',
    METADATA: 'Metadata!A:B',
    CATEGORIES: 'Categories!A:Z'
};

export type HeaderMap = Record<string, number>;

export const DEFAULT_EXPENSE_MAP: HeaderMap = { id: 0, date: 1, description: 2, amount: 3, paidBy: 4, category: 5, splits: 6, meta: 7 };
export const DEFAULT_SETTLEMENT_MAP: HeaderMap = { id: 0, date: 1, fromUserId: 2, toUserId: 3, amount: 4, method: 5, notes: 6 };
export const DEFAULT_MEMBER_MAP: HeaderMap = { userId: 0, email: 1, name: 2, role: 3, joinedAt: 4 };
export const DEFAULT_CATEGORY_MAP: HeaderMap = { id: 0, name: 1, icon: 2, description: 3, updatedAt: 4, deletedAt: 5 };


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

function safeDate(val: unknown, fallback: Date = new Date(0)): Date {
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    if (typeof val === "string" || typeof val === "number") {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d;
    }
    return fallback;
}

function safeIso(val: unknown, fallbackIso?: string): string {
    const d = safeDate(val, fallbackIso ? safeDate(fallbackIso) : new Date());
    return d.toISOString();
}

const FORMULA_TRIGGER_REGEX = /^[\=\+\-\@\t\r]/;

export function sanitizeSheetValue<T>(val: T): T {
    if (typeof val === 'string' && FORMULA_TRIGGER_REGEX.test(val)) {
        return `'${val}` as unknown as T;
    }
    return val;
}

export function desanitizeSheetValue(val: unknown): string {
    if (typeof val === 'string') {
        if (val.startsWith("'") && FORMULA_TRIGGER_REGEX.test(val.slice(1))) {
            return val.slice(1);
        }
        return val;
    }
    return val !== undefined && val !== null ? String(val) : '';
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
        const paidByIdx = getHeaderIndex(headerMap, 'paidBy') ?? getHeaderIndex(headerMap, 'paidByUserId', 4)!;
        const catIdx = getHeaderIndex(headerMap, 'category', 5)!;
        const splitsIdx = getHeaderIndex(headerMap, 'splits', 6)!;
        const metaIdx = getHeaderIndex(headerMap, 'meta');
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');

        const id = row[idIdx];
        const date = row[dateIdx];
        const description = desanitizeSheetValue(row[descIdx]);
        const amountRaw = row[amountIdx];
        const paidByUserId = desanitizeSheetValue(row[paidByIdx]);
        const category = desanitizeSheetValue(row[catIdx]);
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

        const parsedDate = safeDate(date, new Date(0));
        const createdAt = meta.createdAt ? safeDate(meta.createdAt, parsedDate) : parsedDate;
        const updatedAt = updatedAtCol
            ? safeDate(updatedAtCol, parsedDate)
            : meta.lastModified
                ? safeDate(meta.lastModified, parsedDate)
                : parsedDate;

        const expense: Expense = {
            id: id ? String(id) : "",
            date: parsedDate,
            description,
            amount,
            paidByUserId,
            category,
            splits,
            createdAt,
            updatedAt,
        };

        const rawDeleted = deletedAtCol || meta.deletedAt;
        if (rawDeleted) {
            expense.deletedAt = safeDate(rawDeleted);
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

        const dateIso = safeIso(expense.date);
        const createdIso = expense.createdAt ? safeIso(expense.createdAt, dateIso) : dateIso;
        const updatedIso = expense.updatedAt ? safeIso(expense.updatedAt, dateIso) : dateIso;
        const deletedIso = expense.deletedAt ? safeIso(expense.deletedAt, updatedIso) : undefined;

        setCol('id', expense.id);
        setCol('date', dateIso);
        setCol('description', sanitizeSheetValue(expense.description));
        setCol('amount', expense.amount);
        setCol('paidBy', sanitizeSheetValue(expense.paidByUserId));
        setCol('paidByUserId', sanitizeSheetValue(expense.paidByUserId));
        setCol('category', sanitizeSheetValue(expense.category));
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
        const fromUserId = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'fromUserId', 2)!]);
        const toUserId = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'toUserId', 3)!]);
        const amountRaw = row[getHeaderIndex(headerMap, 'amount', 4)!];
        const method = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'method', 5)!]);
        const notes = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'notes', 6)!]);
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');
        const updatedAtCol = updatedAtIdx !== undefined ? row[updatedAtIdx] : undefined;
        const deletedAtCol = deletedAtIdx !== undefined ? row[deletedAtIdx] : undefined;

        let amount = 0;
        if (amountRaw !== undefined && amountRaw !== null && amountRaw !== "") {
            amount = typeof amountRaw === 'string' ? parseFloat(amountRaw.replace(',', '.')) : parseFloat(String(amountRaw));
        }
        if (isNaN(amount)) amount = 0;

        const parsedDate = safeDate(date, new Date(0));
        const updatedAt = updatedAtCol ? safeDate(updatedAtCol, parsedDate) : parsedDate;

        const settlement: Settlement = {
            id: id ? String(id) : "",
            date: parsedDate,
            fromUserId,
            toUserId,
            amount,
            method: method || "cash",
            notes,
            updatedAt
        };

        if (deletedAtCol) {
            settlement.deletedAt = safeDate(deletedAtCol);
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

        const dateIso = safeIso(settlement.date);
        const updatedIso = settlement.updatedAt
            ? safeIso(settlement.updatedAt, dateIso)
            : dateIso;

        setCol('id', settlement.id);
        setCol('date', dateIso);
        setCol('fromUserId', sanitizeSheetValue(settlement.fromUserId));
        setCol('toUserId', sanitizeSheetValue(settlement.toUserId));
        setCol('amount', settlement.amount);
        setCol('method', sanitizeSheetValue(settlement.method));
        setCol('notes', sanitizeSheetValue(settlement.notes || ""));
        setCol('updatedAt', updatedIso);
        if (settlement.deletedAt) {
            setCol('deletedAt', safeIso(settlement.deletedAt, updatedIso));
        }

        return row;
    }

    static mapToMember(row: any[], rowIndex: number, headerMap: HeaderMap = DEFAULT_MEMBER_MAP): SheetRow<Member> {
        const userId = row[getHeaderIndex(headerMap, 'userId', 0)!];
        const email = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'email', 1)!]);
        const name = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'name', 2)!]);
        const role = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'role', 3)!]);
        const joinedAt = row[getHeaderIndex(headerMap, 'joinedAt', 4)!];
        const updatedAtIdx = getHeaderIndex(headerMap, 'updatedAt');
        const deletedAtIdx = getHeaderIndex(headerMap, 'deletedAt');
        const updatedAtCol = updatedAtIdx !== undefined ? row[updatedAtIdx] : undefined;
        const deletedAtCol = deletedAtIdx !== undefined ? row[deletedAtIdx] : undefined;

        const parsedJoinedAt = safeDate(joinedAt, new Date(0));
        const updatedAt = updatedAtCol ? safeDate(updatedAtCol, parsedJoinedAt) : parsedJoinedAt;

        const member: Member = {
            userId: userId ? String(userId) : "",
            email,
            name,
            role: (role === "owner" || role === "member") ? role : "member",
            joinedAt: parsedJoinedAt,
            updatedAt
        };

        if (deletedAtCol) {
            member.deletedAt = safeDate(deletedAtCol);
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

        const joinedIso = safeIso(member.joinedAt);
        const updatedIso = member.updatedAt
            ? safeIso(member.updatedAt, joinedIso)
            : joinedIso;

        setCol('userId', member.userId);
        setCol('email', sanitizeSheetValue(member.email || ""));
        setCol('name', sanitizeSheetValue(member.name || ""));
        setCol('role', sanitizeSheetValue(member.role || "member"));
        setCol('joinedAt', joinedIso);
        setCol('updatedAt', updatedIso);
        if (member.deletedAt) {
            setCol('deletedAt', safeIso(member.deletedAt, updatedIso));
        }

        return row;
    }

    static mapToCategory(row: any[], rowIndex: number, headerMap: HeaderMap = DEFAULT_CATEGORY_MAP): SheetRow<ExpenseCategory> {
        const id = row[getHeaderIndex(headerMap, 'id', 0)!];
        const name = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'name', 1)!]);
        const icon = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'icon', 2)!]);
        const description = desanitizeSheetValue(row[getHeaderIndex(headerMap, 'description', 3)!]);
        const updatedAtCol = row[getHeaderIndex(headerMap, 'updatedAt', 4)!];
        const deletedAtCol = row[getHeaderIndex(headerMap, 'deletedAt', 5)!];

        const updatedAt = updatedAtCol ? safeDate(updatedAtCol) : undefined;
        const deletedAt = deletedAtCol ? safeDate(deletedAtCol) : undefined;

        const category: ExpenseCategory = {
            id: id ? String(id).trim() : "",
            name: name || "",
            icon: icon || "",
            description: description || "",
            updatedAt,
            deletedAt
        };

        return { entity: category, rowIndex };
    }

    static mapFromCategory(category: ExpenseCategory, headerMap: HeaderMap = DEFAULT_CATEGORY_MAP): any[] {
        let maxIdx = 0;
        for (const idx of Object.values(headerMap)) {
            if (idx > maxIdx) maxIdx = idx;
        }
        const row = new Array(maxIdx + 1).fill("");

        const setCol = (key: string, val: any) => {
            const idx = getHeaderIndex(headerMap, key);
            if (idx !== undefined) row[idx] = val;
        };

        const updatedIso = category.updatedAt ? safeIso(category.updatedAt) : new Date().toISOString();

        setCol('id', sanitizeSheetValue(category.id));
        setCol('name', sanitizeSheetValue(category.name));
        setCol('icon', sanitizeSheetValue(category.icon || ""));
        setCol('description', sanitizeSheetValue(category.description || ""));
        setCol('updatedAt', updatedIso);
        if (category.deletedAt) {
            setCol('deletedAt', safeIso(category.deletedAt, updatedIso));
        }

        return row;
    }
}
