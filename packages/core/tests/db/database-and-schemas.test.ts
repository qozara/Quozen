import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRxDatabase, addRxPlugin } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import {
    createQuozenDatabase,
    destroyQuozenDatabase,
    expenseSchema,
    settlementSchema,
    memberSchema,
    userSettingsSchema,
    type QuozenDatabase
} from "../../src/db";
import { SheetDataMapper } from "../../src/infrastructure/SheetDataMapper";
import { ValidationService } from "../../src/schema/ValidationService";
import { migrations } from "../../src/schema/migrations";
import { GoogleSheetsFetchClient } from "@qozara/gdocs-schema";

addRxPlugin(RxDBMigrationSchemaPlugin);

describe("Phase 1: RxDB Local Persistence, Schemas & Dual-Layer Migrations", () => {
    let db: QuozenDatabase | null = null;

    afterEach(async () => {
        if (db) {
            await destroyQuozenDatabase(db);
            db = null;
        }
    });

    it("initializes local RxDB with user_settings, expenses, settlements, and members collections", async () => {
        db = await createQuozenDatabase({
            name: `test_quozen_db_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        expect(db.collections.user_settings).toBeDefined();
        expect(db.collections.expenses).toBeDefined();
        expect(db.collections.settlements).toBeDefined();
        expect(db.collections.members).toBeDefined();
    });

    it("isolates expenses, settlements, and members by groupId within the single local RxDB instance", async () => {
        db = await createQuozenDatabase({
            name: `test_quozen_isolation_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        const nowIso = new Date().toISOString();

        await db.expenses.insert({
            id: "exp-g1",
            groupId: "group-1",
            description: "Dinner G1",
            amount: 100,
            category: "Food",
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 50 }, { userId: "u2", amount: 50 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await db.expenses.insert({
            id: "exp-g2",
            groupId: "group-2",
            description: "Hotel G2",
            amount: 250,
            category: "Travel",
            date: nowIso,
            paidByUserId: "u2",
            splits: [{ userId: "u1", amount: 125 }, { userId: "u2", amount: 125 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        const g1Expenses = await db.expenses.find({ selector: { groupId: "group-1" } }).exec();
        const g2Expenses = await db.expenses.find({ selector: { groupId: "group-2" } }).exec();

        expect(g1Expenses).toHaveLength(1);
        expect(g1Expenses[0].description).toBe("Dinner G1");
        expect(g2Expenses).toHaveLength(1);
        expect(g2Expenses[0].description).toBe("Hotel G2");
    });

    it("executes offline RxDB collection schema migrations (Tier 2) without data loss", async () => {
        const storage = getRxStorageMemory();
        const dbName = `test_quozen_migration_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // 1. Create a v0 database and insert a v0 expense
        const dbV0 = await createRxDatabase({
            name: dbName,
            storage
        });

        await dbV0.addCollections({
            expenses: {
                schema: {
                    ...expenseSchema,
                    version: 0
                }
            }
        });

        const nowIso = "2026-01-01T00:00:00.000Z";
        await dbV0.expenses.insert({
            id: "legacy-exp-1",
            groupId: "group-1",
            description: "Legacy Dinner",
            amount: 42,
            category: "Food",
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 42 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await dbV0.close();

        // 2. Re-open with a bumped v1 schema and migration strategy
        const dbV1 = await createRxDatabase({
            name: dbName,
            storage
        });

        const v1ExpenseSchema = {
            ...expenseSchema,
            version: 1,
            properties: {
                ...expenseSchema.properties,
                currency: { type: "string", maxLength: 10 }
            }
        };

        await dbV1.addCollections({
            expenses: {
                schema: v1ExpenseSchema,
                migrationStrategies: {
                    1: (oldDoc: any) => {
                        oldDoc.currency = oldDoc.currency || "USD";
                        return oldDoc;
                    }
                }
            }
        });

        const migratedDoc = await dbV1.expenses.findOne("legacy-exp-1").exec();
        expect(migratedDoc).not.toBeNull();
        expect(migratedDoc.get("description")).toBe("Legacy Dinner");
        expect(migratedDoc.get("currency")).toBe("USD");

        await dbV1.close();
    });

    it("supports dynamic case-insensitive header mapping and fallback timestamp parsing for legacy sheets", () => {
        // Simulate a user having reordered columns and used mixed-case headers in Google Sheets
        const headers = ["Description", "ID", "Amount", "Date", "PaidBy", "Category", "Splits"];
        const headerMap = SheetDataMapper.buildHeaderMap(headers);

        const reorderedRow = [
            "Tacos",
            "exp-999",
            "30.50",
            "2025-05-10T12:00:00.000Z",
            "u1",
            "Food",
            JSON.stringify([{ userId: "u1", amount: 30.5 }])
        ];

        const mappedExpense = SheetDataMapper.mapToExpense(reorderedRow, 2, headerMap);
        expect(mappedExpense.entity.id).toBe("exp-999");
        expect(mappedExpense.entity.description).toBe("Tacos");
        expect(mappedExpense.entity.amount).toBe(30.5);
        expect(mappedExpense.entity.paidByUserId).toBe("u1");
        // Missing meta/updatedAt falls back to date
        expect(mappedExpense.entity.updatedAt.toISOString()).toBe("2025-05-10T12:00:00.000Z");
        expect(mappedExpense.entity.deletedAt).toBeUndefined();

        // Settlement fallback timestamp parsing
        const settlementRow = ["set-1", "2025-06-01T15:30:00.000Z", "u2", "u1", "15", "cash", "Settled"];
        const mappedSettlement = SheetDataMapper.mapToSettlement(settlementRow, 2);
        expect(mappedSettlement.entity.updatedAt).toBeInstanceOf(Date);
        expect(mappedSettlement.entity.updatedAt?.toISOString()).toBe("2025-06-01T15:30:00.000Z");

        // Member fallback timestamp parsing
        const memberRow = ["u1", "u1@example.com", "Alice", "owner", "2025-01-15T08:00:00.000Z"];
        const mappedMember = SheetDataMapper.mapToMember(memberRow, 2);
        expect(mappedMember.entity.updatedAt).toBeInstanceOf(Date);
        expect(mappedMember.entity.updatedAt?.toISOString()).toBe("2025-01-15T08:00:00.000Z");
    });

    it("creates a safety backup before repairing a spreadsheet when createBackup is available", async () => {
        let repaired = false;
        const mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {}, modifiedTime: "2026-01-01T00:00:00Z" }),
            updateFileAppProperties: vi.fn().mockResolvedValue(undefined),
            createBackup: vi.fn().mockResolvedValue("backup-file-id-123"),
            getSpreadsheet: vi.fn().mockResolvedValue({
                sheets: [
                    { properties: { title: "Expenses", sheetId: 1 } },
                    { properties: { title: "Settlements", sheetId: 2 } },
                    { properties: { title: "Members", sheetId: 3 } },
                    { properties: { title: "Categories", sheetId: 4 } },
                    { properties: { title: "_migrations", sheetId: 5 } },
                    { properties: { title: "_meta", sheetId: 6 } }
                ]
            }),
            batchGet: vi.fn().mockImplementation((_id: string, ranges: string[]) => {
                if (ranges && ranges[0] && ranges[0].includes("_migrations")) {
                    return Promise.resolve({
                        valueRanges: [{ values: [["version", "migrated_at"], ["3", "2026-01-01T00:00:00Z"]] }]
                    });
                }
                const expenseHeaders = repaired
                    ? ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]
                    : ["id", "date", "description", "paidBy", "category", "splits", "meta"];
                return Promise.resolve({
                    valueRanges: [
                        { values: [expenseHeaders] },
                        { values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
                        { values: [["userId", "email", "name", "role", "joinedAt"]] },
                        { values: [["id", "name", "icon", "description", "updatedAt", "deletedAt"]] },
                        { values: [["key", "value", "updatedAt"]] }
                    ]
                });
            }),
            batchUpdate: vi.fn().mockImplementation(() => {
                repaired = true;
                return Promise.resolve({});
            })
        };

        vi.spyOn(GoogleSheetsFetchClient.prototype, "getFileAppProperties").mockImplementation(mockClient.getFileAppProperties);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "createBackup").mockImplementation(mockClient.createBackup);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "acquireLock").mockResolvedValue(true as any);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "releaseLock").mockResolvedValue(true as any);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "getSpreadsheet").mockImplementation(mockClient.getSpreadsheet);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "getSpreadsheetMetadata").mockImplementation(mockClient.getSpreadsheet);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "batchGet").mockImplementation(mockClient.batchGet);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "batchUpdate").mockImplementation(mockClient.batchUpdate);
        vi.spyOn(GoogleSheetsFetchClient.prototype, "updateFileAppProperties").mockImplementation(mockClient.updateFileAppProperties);

        const service = new ValidationService(() => "valid-token");
        await service.repairFile("sheet-123");

        expect(mockClient.createBackup).toHaveBeenCalledWith("sheet-123", undefined);
        expect(mockClient.batchUpdate).toHaveBeenCalled();

        vi.restoreAllMocks();
    });
});
