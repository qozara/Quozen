import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { createQuozenDatabase, destroyQuozenDatabase, QuozenDatabase } from "../../src/db";
import { ReplicationCoordinator } from "../../src/sync/ReplicationCoordinator";
import { CompositeCloudSyncProvider } from "../../src/sync/CompositeCloudSyncProvider";
import { TabularStorageDriver } from "../../src/sync/types";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

describe("Spreadsheet Migration vs Repair Protection & Pre-Sync Verification", () => {
    let mockClient: any;
    let mockValidator: any;
    let mockMigrationManager: any;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("identifies legacy spreadsheet lacking _migrations tab as UPGRADE_REQUIRED, NEVER as CORRUPTED", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {} }), // No quozen_schema_version
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheet: vi.fn().mockResolvedValue({
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } }
                ]
            }),
            batchGet: vi.fn().mockRejectedValue(new Error("Google API 400: Unable to parse range: _migrations!A2:B")),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        mockValidator = {
            // Validator will report missing Categories tab because it doesn't exist yet in v1
            validateStructure: vi.fn().mockResolvedValue({
                valid: false,
                errors: ['Tab "Categories" is missing']
            })
        };

        mockMigrationManager = {
            runMigrations: vi.fn().mockResolvedValue({ success: true, applied: [2] })
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).validator = mockValidator;
        (service as any).migrationManager = mockMigrationManager;

        const health = await service.checkHealth("legacy-group-123");

        // MUST be UPGRADE_REQUIRED, NOT CORRUPTED!
        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
        expect(health.latestVersion).toBe(QuozenSchema.version);
    });

    it("identifies spreadsheet with _migrations at version 1 as UPGRADE_REQUIRED, NEVER as CORRUPTED", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: { quozen_schema_version: "1" } }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheet: vi.fn().mockResolvedValue({
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } },
                    { properties: { title: "_migrations" } }
                ]
            }),
            batchGet: vi.fn().mockResolvedValue({
                valueRanges: [{ values: [["version", "migrated_at"], ["1", "2024-01-01T00:00:00.000Z"]] }]
            }),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        mockValidator = {
            validateStructure: vi.fn().mockResolvedValue({
                valid: false,
                errors: ['Tab "Categories" is missing', 'Tab "Expenses" is missing column "meta"']
            })
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).validator = mockValidator;

        const health = await service.checkHealth("v1-group-456");

        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
    });

    it("only reports CORRUPTED when _migrations matches expected version but structure is corrupted by manual edits", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: { quozen_schema_version: "2" } }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheet: vi.fn().mockResolvedValue({
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } },
                    { properties: { title: "Categories" } },
                    { properties: { title: "_migrations" } }
                ]
            }),
            batchGet: vi.fn().mockResolvedValue({
                valueRanges: [{ values: [["version", "migrated_at"], ["1", "2024-01-01"], ["2", "2026-01-01"]] }]
            }),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        mockValidator = {
            // Missing a required column due to user tampering in Google Sheets
            validateStructure: vi.fn().mockResolvedValue({
                valid: false,
                errors: ['Tab "Expenses" is missing column "amount"']
            })
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).validator = mockValidator;

        const health = await service.checkHealth("v2-tampered-group");

        // Version is 2, matches latest, but structure is invalid -> THIS is corruption!
        expect(health.status).toBe(ValidationStatus.CORRUPTED);
        expect(health.canAutoMigrate).toBe(false);
        expect(health.currentVersion).toBe(2);
    });

    it("repairFile delegates to migrateFile if spreadsheet version is behind expected", async () => {
        const service = new ValidationService(() => "test-token");
        const mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({
                appProperties: { quozen_schema_version: "1" }
            }),
            updateFileAppProperties: vi.fn().mockResolvedValue({})
        };
        (service as any).client = mockClient;
        const migrateSpy = vi.spyOn(service, "migrateFile").mockResolvedValue();

        await service.repairFile("legacy-sheet");
        expect(migrateSpy).toHaveBeenCalledWith("legacy-sheet", undefined);
    });

    it("ReplicationCoordinator immediately aborts runSyncCycle when provider transitions to upgrade_required during pull without modifying local docs or pushing empty deletions", async () => {
        const dbName = `test_abort_db_${Date.now()}`;
        const db = await createQuozenDatabase({
            name: dbName,
            storage: getRxStorageMemory()
        });

        // Seed 2 local expenses in RxDB
        await db.expenses.bulkUpsert([
            {
                id: "exp-1",
                groupId: "group-abort-test",
                description: "Local Dinner",
                amount: 100,
                category: "food_dining",
                date: "2026-01-01",
                paidByUserId: "user-1",
                splits: [{ userId: "user-1", amount: 100 }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
            },
            {
                id: "exp-2",
                groupId: "group-abort-test",
                description: "Local Taxi",
                amount: 30,
                category: "transportation",
                date: "2026-01-01",
                paidByUserId: "user-1",
                splits: [{ userId: "user-1", amount: 30 }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
            }
        ]);

        const pushSpy = vi.fn().mockResolvedValue(undefined);

        let currentStatus = "idle";
        const mockProvider: any = {
            isInitialized: () => true,
            getStatus: () => currentStatus,
            onStatusChange: vi.fn().mockReturnValue(() => {}),
            pull: vi.fn().mockImplementation(async () => {
                // Simulating pull detecting unmigrated sheet, setting upgrade_required and returning empty payload
                currentStatus = "upgrade_required";
                return [];
            }),
            push: pushSpy,
            getActiveGroupId: () => "group-abort-test"
        };

        const coordinator = new ReplicationCoordinator(db, mockProvider);
        await coordinator.sync("group-abort-test");

        // Local expenses MUST NOT be marked deletedAt!
        const remainingExpenses = await db.expenses.find({ selector: { groupId: "group-abort-test" } }).exec();
        expect(remainingExpenses).toHaveLength(2);
        expect(remainingExpenses[0].deletedAt).toBeNull();
        expect(remainingExpenses[1].deletedAt).toBeNull();

        // Push MUST NOT have been called with deletions!
        expect(pushSpy).not.toHaveBeenCalled();

        await destroyQuozenDatabase(db);
    });
});
