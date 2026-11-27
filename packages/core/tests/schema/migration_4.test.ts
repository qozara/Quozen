import { describe, it, expect } from "vitest";
import { migration_4 } from "../../src/schema/migrations/4_add_category_translations";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { SchemaEngine } from "@qozara/cloud-sync";
import { GoogleSheetsContainerDriver } from "@qozara/cloud-sync-google";
import { migrations } from "../../src/schema/migrations";

class FakeGoogleSheetsClient {
    public sheets: any[] = [];
    public cellData: Map<string, any[][]> = new Map();

    constructor(initialSheets: string[], initialData: Record<string, any[][]>) {
        this.sheets = initialSheets.map((title, i) => ({
            properties: {
                title,
                sheetId: i + 1,
                gridProperties: {
                    rowCount: 100,
                    columnCount: Math.max(6, (initialData[title]?.[0]?.length ?? 6))
                }
            }
        }));
        for (const [key, val] of Object.entries(initialData)) {
            this.cellData.set(key, JSON.parse(JSON.stringify(val)));
        }
    }

    async getSpreadsheet(_id: string) {
        return { sheets: this.sheets };
    }

    async getSpreadsheetMetadata(_id: string) {
        return this.getSpreadsheet(_id);
    }

    async createBackup(id: string) {
        return `backup-${id}`;
    }

    async deleteBackup() {
        return {};
    }

    async batchUpdateValues(_id: string, data: Array<{ range: string; values: any[][] }>) {
        for (const item of data) {
            const sheetName = item.range.split("!")[0].replace(/^'|'$/g, "");
            this.cellData.set(sheetName, JSON.parse(JSON.stringify(item.values)));
        }
        return {};
    }

    async setSheetHidden() {
        return {};
    }

    async protectSheet() {
        return {};
    }

    async acquireLock() {
        return true;
    }

    async releaseLock() {
        return true;
    }

    async updateFileAppProperties() {
        return {};
    }

    async getFileAppProperties() {
        return { appProperties: { quozen_schema_version: "3" } };
    }

    async getFileMetadata() {
        return {
            properties: { quozen_type: "group" },
            appProperties: { quozen_schema_version: "3" },
        };
    }

    async updateFileProperties() {
        return {};
    }

    async batchGet(_id: string, ranges: string[]) {
        return {
            valueRanges: ranges.map(range => {
                const sheetName = range.split("!")[0].replace(/^'|'$/g, "");
                return { values: this.cellData.get(sheetName) || [] };
            })
        };
    }

    async batchUpdate(_id: string, requests: any[]) {
        const replies: any[] = [];
        for (const req of requests) {
            if (req.appendDimension) {
                const sheet = this.sheets.find(s => s.properties.sheetId === req.appendDimension.sheetId);
                if (sheet && req.appendDimension.dimension === "COLUMNS") {
                    sheet.properties.gridProperties.columnCount += req.appendDimension.length;
                }
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
            } else if (req.deleteDimension) {
                const sheetId = req.deleteDimension.range?.sheetId;
                const sheet = this.sheets.find(s => s.properties.sheetId === sheetId);
                if (sheet && req.deleteDimension.range?.dimension === "COLUMNS") {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    const start = req.deleteDimension.range.startIndex;
                    const count = req.deleteDimension.range.endIndex - start;
                    rows.forEach(r => r.splice(start, count));
                    this.cellData.set(title, rows);
                }
            }
        }
        return { replies };
    }
}

describe("Google Spreadsheet Migration 4 (add category name_es & description_es)", () => {
    it("adds name_es and description_es headers and backfills untouched defaults while preserving custom and renamed rows", async () => {
        const client = new FakeGoogleSheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations", "_meta"],
            {
                Expenses: [["id", "date", "description", "amount", "paidBy", "category", "splits"]],
                Settlements: [["id", "date", "fromUserId", "toUserId", "amount", "method"]],
                Members: [["userId", "name", "role", "joinedAt"]],
                Categories: [
                    ["id", "name", "icon", "description", "updatedAt", "deletedAt"],
                    ["food_dining", "Food & Dining", "utensils", "Restaurants, groceries, drinks", "2026-01-01T00:00:00Z", ""],
                    ["transportation", "Company Fleet", "car", "Corporate vehicles", "2026-01-01T00:00:00Z", ""],
                    ["pet_care", "Pet Care", "dog", "Vet & food", "2026-01-01T00:00:00Z", ""]
                ],
                _migrations: [["version", "migrated_at"], ["2", "2026-01-01T00:00:00Z"], ["3", "2026-02-01T00:00:00Z"]],
                _meta: [["key", "value", "updatedAt"]]
            }
        );

        const engine = new SchemaEngine(new GoogleSheetsContainerDriver(client as any));
        await engine.migrate("sheet-v3", QuozenSchema, migrations);

        const rows = client.cellData.get("Categories")!;
        const headers = rows[0];
        const nameEsIdx = headers.indexOf("name_es");
        const descEsIdx = headers.indexOf("description_es");

        expect(nameEsIdx).toBeGreaterThan(-1);
        expect(descEsIdx).toBeGreaterThan(-1);

        // Untouched default food_dining gets Spanish translation
        expect(rows[1][nameEsIdx]).toBe("Comida y bebida");
        expect(rows[1][descEsIdx]).toBe("Restaurantes, supermercado, bebidas");

        // User-renamed default ("Company Fleet") is NOT overwritten with generic "Transporte"
        expect(rows[2][nameEsIdx] || "").toBe("");
        expect(rows[2][descEsIdx] || "").toBe("");

        // Custom category ("Pet Care") is left blank so canonical name applies across languages unless user fills it
        expect(rows[3][nameEsIdx] || "").toBe("");
        expect(rows[3][descEsIdx] || "").toBe("");

        // Idempotency check
        await migration_4.up(client as any, "sheet-v3");
        expect(rows[0].filter((h: string) => h === "name_es")).toHaveLength(1);
        expect(rows[0].filter((h: string) => h === "description_es")).toHaveLength(1);
    });
});
