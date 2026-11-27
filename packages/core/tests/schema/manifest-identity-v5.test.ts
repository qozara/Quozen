import { describe, it, expect } from "vitest";
import { MANIFEST_KEYS, QOZARA_MANIFEST_VERSION, SchemaEngine } from "@qozara/cloud-sync";
import { GoogleSheetsContainerDriver } from "@qozara/cloud-sync-google";
import { QuozenSchema, getQuozenSchemaHash } from "../../src/schema/SchemaDefinition";
import { migrations } from "../../src/schema/migrations";
import { migration_5 } from "../../src/schema/migrations/5_stamp_manifest_identity";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { SheetDataMapper } from "../../src/infrastructure/SheetDataMapper";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { ForeignDocumentError, UnmanagedDocumentError } from "../../src/errors";
import { QUOZEN_PREFIX } from "../../src/types";

class InMemorySheetsClient {
    public sheets: any[] = [];
    public cellData = new Map<string, any[][]>();
    public properties: Record<string, string> = {};
    public appProperties: Record<string, string> = {};

    constructor(
        initialSheets: string[],
        initialData: Record<string, any[][]>,
        props: { properties?: Record<string, string>; appProperties?: Record<string, string> } = {}
    ) {
        this.sheets = initialSheets.map((title, i) => ({
            properties: {
                title,
                sheetId: i + 1,
                gridProperties: { rowCount: 100, columnCount: Math.max(8, initialData[title]?.[0]?.length ?? 8) },
            },
        }));
        for (const [k, v] of Object.entries(initialData)) {
            this.cellData.set(k, JSON.parse(JSON.stringify(v)));
        }
        this.properties = props.properties ? { ...props.properties } : {};
        this.appProperties = props.appProperties ? { ...props.appProperties } : {};
    }

    async getSpreadsheet() {
        return { properties: { title: "Test Group" }, sheets: this.sheets };
    }

    async getSpreadsheetMetadata() {
        return this.getSpreadsheet();
    }

    async getFileMetadata() {
        return {
            properties: this.properties,
            appProperties: this.appProperties,
            modifiedTime: "2026-11-27T00:00:00.000Z",
        };
    }

    async updateFileProperties(_id: string, data: { properties?: Record<string, string>; appProperties?: Record<string, string> }) {
        if (data.properties) this.properties = { ...this.properties, ...data.properties };
        if (data.appProperties) this.appProperties = { ...this.appProperties, ...data.appProperties };
        return {};
    }

    async createBackup(id: string) {
        return `backup-${id}`;
    }

    async deleteBackup() {
        return {};
    }

    async acquireLock() {
        return true;
    }

    async releaseLock() {
        return true;
    }

    async batchGet(_id: string, ranges: string[]) {
        return {
            valueRanges: ranges.map((range) => {
                const rawTab = range.split("!")[0].replace(/^'|'$/g, "");
                return { values: this.cellData.get(rawTab) || [] };
            }),
        };
    }

    async batchUpdateValues(_id: string, data: Array<{ range: string; values: any[][] }>) {
        for (const entry of data) {
            const tab = entry.range.split("!")[0].replace(/^'|'$/g, "");
            this.cellData.set(tab, JSON.parse(JSON.stringify(entry.values)));
        }
        return {};
    }

    async batchUpdate(_id: string, requests: any[]) {
        const replies: any[] = [];
        for (const req of requests) {
            if (req.addSheet) {
                const sheetId = this.sheets.length + 1;
                this.sheets.push({
                    properties: {
                        ...req.addSheet.properties,
                        sheetId,
                    },
                });
                this.cellData.set(req.addSheet.properties.title, []);
                replies.push({ addSheet: { properties: { sheetId, title: req.addSheet.properties.title } } });
            } else if (req.updateCells) {
                const sheet = this.sheets.find((s) => s.properties.sheetId === req.updateCells.range?.sheetId);
                if (sheet) {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    const startRow = req.updateCells.range?.startRowIndex || 0;
                    const startCol = req.updateCells.range?.startColumnIndex || 0;
                    req.updateCells.rows?.forEach((r: any, rIdx: number) => {
                        const rowIdx = startRow + rIdx;
                        while (rows.length <= rowIdx) rows.push([]);
                        r.values?.forEach((cell: any, cIdx: number) => {
                            rows[rowIdx][startCol + cIdx] =
                                cell.userEnteredValue?.stringValue ??
                                cell.userEnteredValue?.numberValue ??
                                "";
                        });
                    });
                    this.cellData.set(title, rows);
                }
            } else if (req.appendCells) {
                const sheet = this.sheets.find((s) => s.properties.sheetId === req.appendCells.sheetId);
                if (sheet) {
                    const title = sheet.properties.title;
                    const rows = this.cellData.get(title) || [];
                    for (const r of req.appendCells.rows || []) {
                        rows.push(
                            (r.values || []).map(
                                (cell: any) =>
                                    cell.userEnteredValue?.stringValue ??
                                    cell.userEnteredValue?.numberValue ??
                                    ""
                            )
                        );
                    }
                    this.cellData.set(title, rows);
                }
            }
        }
        return { replies };
    }
}

describe("Quozen v5 Manifest Identity, Rejection Guards & Formula-Safe Row Mapping", () => {
    it("migration_5 stamps canonical _meta manifest identity when upgrading v4 to v5", async () => {
        expect(QuozenSchema.version).toBe(5);
        expect(migration_5.version).toBe(5);

        const client = new InMemorySheetsClient(
            ["Expenses", "Settlements", "Members", "Categories", "_migrations", "_meta"],
            {
                Expenses: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]],
                Settlements: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]],
                Members: [["userId", "email", "name", "role", "joinedAt"]],
                Categories: [["id", "name", "name_es", "icon", "description", "description_es", "updatedAt", "deletedAt"]],
                _migrations: [["version", "migrated_at"], ["4", "2026-11-26T00:00:00Z"]],
                _meta: [["key", "value", "updatedAt"], ["icon", "plane", "2026-11-26T00:00:00Z"]],
            },
            { properties: { quozen_type: "group" } }
        );

        const engine = new SchemaEngine(new GoogleSheetsContainerDriver(client as any));
        await engine.migrate("quozen-sheet-v4", QuozenSchema, migrations);

        const metaRows = client.cellData.get("_meta") || [];
        const metaMap = Object.fromEntries(metaRows.slice(1).map((r) => [r[0], r[1]]));

        expect(metaMap.icon).toBe("plane");
        expect(metaMap[MANIFEST_KEYS.MANIFEST_VERSION]).toBe(QOZARA_MANIFEST_VERSION);
        expect(metaMap[MANIFEST_KEYS.APP_ID]).toBe("quozen");
        expect(metaMap[MANIFEST_KEYS.DOC_TYPE]).toBe("group");
        expect(metaMap[MANIFEST_KEYS.SCHEMA_VERSION]).toBe("5");
        expect(metaMap[MANIFEST_KEYS.SCHEMA_HASH]).toBe(await getQuozenSchemaHash());
        expect(metaMap[MANIFEST_KEYS.ORIGIN_CONTAINER_ID]).toBe("quozen-sheet-v4");

        const health = await engine.checkHealth("quozen-sheet-v4", QuozenSchema);
        expect(health.status).toBe(ValidationStatus.READY);
    });

    it("ValidationService rejects UNMANAGED and FOREIGN_APP spreadsheets cleanly without mutations", async () => {
        const unmanagedClient = new InMemorySheetsClient(["Sheet1", "Budget"], {
            Sheet1: [["Month", "Total"]],
        });
        const foreignClient = new InMemorySheetsClient(["Daily Logs", "_meta"], {
            _meta: [
                ["key", "value", "updatedAt"],
                ["app_id", "quomida", "2026-11-27T00:00:00Z"],
                ["doc_type", "daily_logs", "2026-11-27T00:00:00Z"],
            ],
        });

        const svcUnmanaged = new ValidationService(() => "token");
        (svcUnmanaged as any).client = unmanagedClient;
        (svcUnmanaged as any).engine = new SchemaEngine(new GoogleSheetsContainerDriver(unmanagedClient as any));
        const unmanagedHealth = await svcUnmanaged.checkHealth("random-id");
        expect(unmanagedHealth.status).toBe(ValidationStatus.UNMANAGED);
        await expect(svcUnmanaged.repairFile("random-id")).rejects.toThrow(UnmanagedDocumentError);
        await expect(svcUnmanaged.migrateFile("random-id")).rejects.toThrow(UnmanagedDocumentError);

        const svcForeign = new ValidationService(() => "token");
        (svcForeign as any).client = foreignClient;
        (svcForeign as any).engine = new SchemaEngine(new GoogleSheetsContainerDriver(foreignClient as any));
        const foreignHealth = await svcForeign.checkHealth("quomida-id");
        expect(foreignHealth.status).toBe(ValidationStatus.FOREIGN_APP);
        expect(foreignHealth.detectedAppId).toBe("quomida");
        await expect(svcForeign.repairFile("quomida-id")).rejects.toThrow(ForeignDocumentError);
        await expect(svcForeign.migrateFile("quomida-id")).rejects.toThrow(ForeignDocumentError);
    });

    it("SheetDataMapper leaves user-added formula columns as undefined while clearing deletedAt to empty string", () => {
        const expenseHeaders = SheetDataMapper.buildHeaderMap([
            "id",
            "date",
            "UserVATFormula",
            "description",
            "amount",
            "paidBy",
            "category",
            "splits",
            "meta",
            "updatedAt",
            "deletedAt",
        ]);
        const row = SheetDataMapper.mapFromExpense(
            {
                id: "exp-1",
                date: new Date("2026-11-27T12:00:00.000Z"),
                description: "Dinner",
                amount: 100,
                paidByUserId: "u1",
                category: "food_dining",
                splits: [{ userId: "u1", amount: 100 }],
                createdAt: new Date("2026-11-27T12:00:00.000Z"),
                updatedAt: new Date("2026-11-27T12:00:00.000Z"),
            },
            expenseHeaders
        );

        expect(row[2]).toBeUndefined();
        expect(row[4]).toBe(100);
        expect(row[10]).toBe("");
    });

    it("GroupRepository.joinGroup rejects FOREIGN_APP and UNMANAGED spreadsheets", async () => {
        const adapter = new InMemoryAdapter();
        const repo = new GroupRepository(adapter as any, {
            id: "u1",
            name: "Alice",
            email: "alice@example.com",
            username: "alice",
        });

        const foreignId = await adapter.createSpreadsheet(`${QUOZEN_PREFIX}Wrong App`, ["Expenses", "_meta"], {});
        await adapter.batchUpdateValues(foreignId, [
            {
                range: "_meta!A1",
                values: [
                    ["key", "value", "updatedAt"],
                    ["app_id", "quomida", "2026-11-27T00:00:00Z"],
                ],
            },
        ]);
        await expect(repo.joinGroup(foreignId)).rejects.toThrow(ForeignDocumentError);

        const unmanagedId = await adapter.createSpreadsheet("Unrelated", ["Sheet1"], {});
        await expect(repo.joinGroup(unmanagedId)).rejects.toThrow(UnmanagedDocumentError);
    });
});
