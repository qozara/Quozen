import { describe, it, expect, vi } from "vitest";
import { migration_2 } from "../../src/schema/migrations/2_add_categories";
import { DEFAULT_CATEGORIES } from "../../src/domain/categories";

class FakeGoogleSheetsClient {
    public sheets: any[] = [];
    public cellData: Map<string, any[][]> = new Map();
    public batchUpdateCalls: any[][] = [];
    public backupRestored = false;
    public createdBackups: string[] = [];

    constructor(initialSheets: string[], initialData: Record<string, any[][]>) {
        this.sheets = initialSheets.map((title, i) => ({
            properties: { title, sheetId: i + 1 }
        }));
        for (const [key, val] of Object.entries(initialData)) {
            this.cellData.set(key, JSON.parse(JSON.stringify(val)));
        }
    }

    async getSpreadsheet(_id: string) {
        return {
            sheets: this.sheets
        };
    }

    async batchGet(_id: string, ranges: string[]) {
        return {
            valueRanges: ranges.map(range => {
                const sheetName = range.split("!")[0];
                return {
                    values: this.cellData.get(sheetName) || []
                };
            })
        };
    }

    async batchUpdate(_id: string, requests: any[]) {
        this.batchUpdateCalls.push(requests);
        const replies: any[] = [];
        for (const req of requests) {
            if (req.addSheet) {
                const title = req.addSheet.properties.title;
                const newSheetId = this.sheets.length + 1;
                this.sheets.push({ properties: { title, sheetId: newSheetId } });
                if (!this.cellData.has(title)) {
                    this.cellData.set(title, []);
                }
                replies.push({ addSheet: { properties: { sheetId: newSheetId } } });
            } else if (req.updateCells) {
                const sheetId = req.updateCells.range?.sheetId;
                const sheet = this.sheets.find(s => s.properties.sheetId === sheetId);
                if (sheet) {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    const startRow = req.updateCells.range.startRowIndex || 0;
                    const startCol = req.updateCells.range.startColumnIndex || 0;
                    req.updateCells.rows?.forEach((r: any, rIdx: number) => {
                        const targetRowIdx = startRow + rIdx;
                        while (rows.length <= targetRowIdx) rows.push([]);
                        r.values?.forEach((cell: any, cIdx: number) => {
                            const val = cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? "";
                            rows[targetRowIdx][startCol + cIdx] = val;
                        });
                    });
                    this.cellData.set(title, rows);
                }
            } else if (req.appendCells) {
                const sheetId = req.appendCells.sheetId;
                const sheet = this.sheets.find(s => s.properties.sheetId === sheetId);
                if (sheet) {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    req.appendCells.rows?.forEach((r: any) => {
                        const rowVals = r.values?.map((cell: any) =>
                            cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? ""
                        ) || [];
                        rows.push(rowVals);
                    });
                    this.cellData.set(title, rows);
                }
            } else if (req.deleteDimension && req.deleteDimension.range?.dimension === "ROWS") {
                const sheetId = req.deleteDimension.range.sheetId;
                const sheet = this.sheets.find(s => s.properties.sheetId === sheetId);
                if (sheet) {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    const start = req.deleteDimension.range.startIndex;
                    const end = req.deleteDimension.range.endIndex;
                    rows.splice(start, end - start);
                    this.cellData.set(title, rows);
                }
            }
        }
        return { replies };
    }

    async createBackup(id: string) {
        const backupId = `backup-${id}`;
        this.createdBackups.push(backupId);
        return backupId;
    }

    async restoreBackup(_backupId: string, _targetId: string) {
        this.backupRestored = true;
    }

    async deleteFile(_id: string) {}
}

describe("Schema Migration 2: Add Categories Tab and Normalize Expenses", () => {
    it("creates Categories tab and normalizes legacy expenses to IDs or 'other'", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members"],
            {
                Expenses: [
                    ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
                    ["e1", "2026-01-01", "Dinner", 50, "u1", "Food & Dining", "[]", "{}"],
                    ["e2", "2026-01-02", "Uber", 20, "u1", "Travel", "[]", "{}"],
                    ["e3", "2026-01-03", "Hotel", 100, "u1", "Lodging", "[]", "{}"],
                    ["e4", "2026-01-04", "Movie", 15, "u1", "Leisure", "[]", "{}"],
                    ["e5", "2026-01-05", "Groceries", 30, "u1", "food", "[]", "{}"],
                    ["e6", "2026-01-06", "Mystery", 40, "u1", "Pizza Night", "[]", "{}"],
                    ["e7", "2026-01-07", "Other", 10, "u1", "", "[]", "{}"]
                ]
            }
        );

        await migration_2.up(client as any, "spreadsheet-123");

        // Verify Categories tab was created and populated with 6 default categories
        expect(client.sheets.some(s => s.properties.title === "Categories")).toBe(true);
        const categoryRows = client.cellData.get("Categories") || [];
        expect(categoryRows.length).toBe(7); // header + 6 defaults
        expect(categoryRows[0]).toEqual(["id", "name", "icon", "description", "updatedAt", "deletedAt"]);
        
        const categoryIds = categoryRows.slice(1).map(r => r[0]);
        expect(categoryIds).toEqual(DEFAULT_CATEGORIES.map(c => c.id));

        // Verify expenses were normalized to IDs
        const expenseRows = client.cellData.get("Expenses") || [];
        expect(expenseRows[1][5]).toBe("food_dining");
        expect(expenseRows[2][5]).toBe("transportation");
        expect(expenseRows[3][5]).toBe("accommodation");
        expect(expenseRows[4][5]).toBe("entertainment");
        expect(expenseRows[5][5]).toBe("food_dining");
        expect(expenseRows[6][5]).toBe("other"); // Pizza Night -> other (per user instruction)
        expect(expenseRows[7][5]).toBe("other"); // Empty -> other
    });

    it("is idempotent: running multiple times does not duplicate categories or corrupt data", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members"],
            {
                Expenses: [
                    ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
                    ["e1", "2026-01-01", "Dinner", 50, "u1", "Food & Dining", "[]", "{}"]
                ]
            }
        );

        await migration_2.up(client as any, "spreadsheet-123");
        const categoriesFirstRun = JSON.parse(JSON.stringify(client.cellData.get("Categories")));
        const expensesFirstRun = JSON.parse(JSON.stringify(client.cellData.get("Expenses")));

        // Run second time
        await migration_2.up(client as any, "spreadsheet-123");
        const categoriesSecondRun = client.cellData.get("Categories");
        const expensesSecondRun = client.cellData.get("Expenses");

        expect(categoriesSecondRun?.length).toBe(categoriesFirstRun?.length);
        expect(expensesSecondRun).toEqual(expensesFirstRun);
    });

    it("handles reordered columns in Expenses sheet dynamically", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members"],
            {
                // category at index 1 instead of 5
                Expenses: [
                    ["id", "category", "date", "description", "amount", "paidBy", "splits", "meta"],
                    ["e1", "Comida", "2026-01-01", "Dinner", 50, "u1", "[]", "{}"]
                ]
            }
        );

        await migration_2.up(client as any, "spreadsheet-123");
        const expenseRows = client.cellData.get("Expenses") || [];
        expect(expenseRows[1][1]).toBe("food_dining");
    });

    it("cleans up duplicate restored categories if present in Categories tab", async () => {
        const nowIso = "2026-02-01T00:00:00.000Z";
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories"],
            {
                Expenses: [
                    ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
                    ["e1", "2026-01-01", "Dinner", 50, "u1", "Food & Dining", "[]", "{}"]
                ],
                Categories: [
                    ["id", "name", "icon", "description", "updatedAt", "deletedAt"],
                    ["food_dining", "Food & Dining", "utensils", "Restaurants, groceries, drinks", nowIso, ""],
                    ["transportation", "Transportation", "car", "Taxis, fuel, public transit, flights", nowIso, ""],
                    ["accommodation", "Accommodation", "bed", "Hotels, rentals, lodging", nowIso, ""],
                    ["entertainment", "Entertainment", "gamepad-2", "Activities, tickets, leisure", nowIso, ""],
                    ["shopping", "Shopping", "shopping-bag", "General purchases", nowIso, ""],
                    ["other", "Other", "more-horizontal", "Anything else", nowIso, ""],
                    ["Accommodation", "Accommodation", "tag", "Restored category", nowIso, ""],
                    ["Food & Dining", "Food & dining", "tag", "Restored category", nowIso, ""],
                    ["Shopping", "Shopping", "tag", "Restored category", nowIso, ""],
                    ["Transportation", "Transportation", "tag", "Restored category", nowIso, ""]
                ]
            }
        );

        await migration_2.up(client as any, "spreadsheet-123");

        const categoryRows = client.cellData.get("Categories") || [];
        // Should only have 7 rows (header + 6 defaults), duplicate Restored category rows cleaned up
        expect(categoryRows.length).toBe(7);
        const categoryIds = categoryRows.slice(1).map(r => r[0]);
        expect(categoryIds).toEqual(DEFAULT_CATEGORIES.map(c => c.id));
    });
});
