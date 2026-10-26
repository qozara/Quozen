import { describe, it, expect } from "vitest";
import { migration_3 } from "../../src/schema/migrations/3_add_meta_tab";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { SchemaEngine } from "@qozara/gdocs-schema";
import { migrations } from "../../src/schema/migrations";

class FakeGoogleSheetsClient {
    public sheets: any[] = [];
    public cellData: Map<string, any[][]> = new Map();
    public batchUpdateCalls: any[][] = [];

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

    async getSpreadsheetMetadata(_id: string) {
        return this.getSpreadsheet(_id);
    }

    async createBackup(id: string, _name?: string) {
        return `backup-${id}`;
    }

    async acquireLock(_id: string, _holder?: string, _ttl?: number) {
        return true;
    }

    async releaseLock(_id: string, _holder?: string) {
        return true;
    }

    async updateFileAppProperties(_id: string, _props: any) {
        return {};
    }

    async getFileAppProperties(_id: string) {
        return { appProperties: { quozen_schema_version: "2" } };
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
                this.sheets.push({
                    properties: {
                        title,
                        sheetId: newSheetId,
                        gridProperties: req.addSheet.properties.gridProperties
                    }
                });
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
                    const startRow = req.updateCells.range?.startRowIndex || 0;
                    const startCol = req.updateCells.range?.startColumnIndex || 0;
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
            } else if (req.deleteSheet) {
                const sheetId = req.deleteSheet.sheetId;
                const idx = this.sheets.findIndex(s => s.properties.sheetId === sheetId);
                if (idx !== -1) {
                    const title = this.sheets[idx].properties.title;
                    this.sheets.splice(idx, 1);
                    this.cellData.delete(title);
                }
            }
        }
        return { replies };
    }
}

describe("Google Spreadsheet Migration 3 (add _meta tab)", () => {
    it("migration_3 has version 3 and implements up and down", () => {
        expect(migration_3.version).toBe(3);
        expect(typeof migration_3.up).toBe("function");
        expect(typeof migration_3.down).toBe("function");
    });

    it("creates _meta tab and writes header row when tab does not exist", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations"],
            {
                Expenses: [["id", "date", "description", "amount", "paidBy", "category", "splits"]],
                Settlements: [["id", "date", "fromUserId", "toUserId", "amount", "method"]],
                Members: [["userId", "name", "role", "joinedAt"]],
                Categories: [["id", "name", "icon", "description", "updatedAt", "deletedAt"]],
                _migrations: [["version", "migrated_at"], ["2", "2026-01-01T00:00:00Z"]]
            }
        );

        await migration_3.up(client as any, "sheet-123");

        const metaSheet = client.sheets.find(s => s.properties.title === "_meta");
        expect(metaSheet).toBeDefined();
        expect(metaSheet.properties.gridProperties?.frozenRowCount).toBe(1);

        const rows = client.cellData.get("_meta");
        expect(rows).toBeDefined();
        expect(rows![0]).toEqual(["key", "value", "updatedAt"]);
    });

    it("is idempotent: does not duplicate _meta tab or overwrite existing data if tab already exists", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations", "_meta"],
            {
                _meta: [
                    ["key", "value", "updatedAt"],
                    ["icon", "palette", "2026-03-01T00:00:00Z"]
                ]
            }
        );

        await migration_3.up(client as any, "sheet-123");

        const metaSheets = client.sheets.filter(s => s.properties.title === "_meta");
        expect(metaSheets).toHaveLength(1);

        const rows = client.cellData.get("_meta");
        expect(rows).toHaveLength(2);
        expect(rows![0]).toEqual(["key", "value", "updatedAt"]);
        expect(rows![1]).toEqual(["icon", "palette", "2026-03-01T00:00:00Z"]);
    });

    it("down removes the _meta sheet", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations", "_meta"],
            {
                _meta: [["key", "value", "updatedAt"]]
            }
        );

        expect(client.sheets.find(s => s.properties.title === "_meta")).toBeDefined();

        await migration_3.down(client as any, "sheet-123");

        expect(client.sheets.find(s => s.properties.title === "_meta")).toBeUndefined();
        expect(client.cellData.has("_meta")).toBe(false);
    });

    it("SchemaEngine migrates a v2 spreadsheet to v3 including _meta tab", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations"],
            {
                Expenses: [["id", "date", "description", "amount", "paidBy", "category", "splits"]],
                Settlements: [["id", "date", "fromUserId", "toUserId", "amount", "method"]],
                Members: [["userId", "name", "role", "joinedAt"]],
                Categories: [["id", "name", "icon", "description", "updatedAt", "deletedAt"]],
                _migrations: [["version", "migrated_at"], ["2", "2026-01-01T00:00:00Z"]]
            }
        );

        const engine = new SchemaEngine(client as any);
        await engine.migrate("sheet-123", QuozenSchema, migrations);

        const metaSheet = client.sheets.find(s => s.properties.title === "_meta");
        expect(metaSheet).toBeDefined();

        const rows = client.cellData.get("_meta");
        expect(rows![0]).toEqual(["key", "value", "updatedAt"]);
    });
});
