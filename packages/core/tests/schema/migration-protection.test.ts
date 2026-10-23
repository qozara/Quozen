import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { createQuozenDatabase, destroyQuozenDatabase, QuozenDatabase } from "../../src/db";
import { ReplicationCoordinator } from "../../src/sync/ReplicationCoordinator";
import { CompositeCloudSyncProvider } from "../../src/sync/CompositeCloudSyncProvider";
import { TabularStorageDriver } from "../../src/sync/types";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { SchemaIncompatibleError } from "../../src/errors";
import { LedgerService } from "../../src/finance/LedgerService";
import { resolveUXStatus, resolveProviderDiagnostic } from "../../src/sync/evaluator";

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

    it("identifies spreadsheet with version higher than app version as INCOMPATIBLE, skipping validateStructure", async () => {
        const higherVersion = QuozenSchema.version + 1; // e.g. 3 when app is 2
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: { quozen_schema_version: String(higherVersion) } }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheet: vi.fn().mockResolvedValue({
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } },
                    { properties: { title: "Categories" } },
                    { properties: { title: "FutureTab" } },
                    { properties: { title: "_migrations" } }
                ]
            }),
            batchGet: vi.fn().mockResolvedValue({
                valueRanges: [{ values: [["version", "migrated_at"], [String(higherVersion), "2027-01-01"]] }]
            }),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        mockValidator = {
            validateStructure: vi.fn()
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).validator = mockValidator;

        const health = await service.checkHealth("future-group-999");

        // MUST be INCOMPATIBLE, NOT CORRUPTED and NOT UPGRADE_REQUIRED!
        expect(health.status).toBe(ValidationStatus.INCOMPATIBLE);
        expect(health.canAutoMigrate).toBe(false);
        expect(health.currentVersion).toBe(higherVersion);
        expect(health.latestVersion).toBe(QuozenSchema.version);

        // Validator must NOT have been called! (Preventing accidental repair/downgrade of newer schema)
        expect(mockValidator.validateStructure).not.toHaveBeenCalled();
    });

    it("repairFile and migrateFile throw SchemaIncompatibleError when spreadsheet schema is higher than app version", async () => {
        const higherVersion = QuozenSchema.version + 1;
        const service = new ValidationService(() => "test-token");
        vi.spyOn(service, "checkHealth").mockResolvedValue({
            spreadsheetId: "future-sheet",
            currentVersion: higherVersion,
            latestVersion: QuozenSchema.version,
            status: ValidationStatus.INCOMPATIBLE,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: false,
            lastModifiedTime: new Date().toISOString()
        });

        await expect(service.repairFile("future-sheet")).rejects.toThrow(SchemaIncompatibleError);
        await expect(service.migrateFile("future-sheet")).rejects.toThrow(SchemaIncompatibleError);
    });

    it("LedgerService.ensureSchemaHealth throws SchemaIncompatibleError when status is INCOMPATIBLE", async () => {
        const service = new ValidationService(() => "test-token");
        vi.spyOn(service, "checkHealth").mockResolvedValue({
            spreadsheetId: "future-sheet",
            currentVersion: QuozenSchema.version + 1,
            latestVersion: QuozenSchema.version,
            status: ValidationStatus.INCOMPATIBLE,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: false,
            lastModifiedTime: new Date().toISOString()
        });

        const mockRepo: any = {
            hasLocalDb: () => false,
            getMembers: vi.fn().mockResolvedValue([{ userId: "u1", role: "admin" }]),
            getExpenses: vi.fn().mockResolvedValue([])
        };

        const ledgerService = new LedgerService(mockRepo, { id: "u1", name: "User 1", email: "u1@test.com" }, service, "future-sheet");

        await expect(ledgerService.getLedger()).rejects.toThrow(SchemaIncompatibleError);
    });

    it("creates a safety backup with spreadsheet title in Google Drive before repairing", async () => {
        const service = new ValidationService(() => "test-token");
        const createBackupSpy = vi.fn().mockResolvedValue("backup-copy-id");
        const mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({
                appProperties: { quozen_schema_version: String(QuozenSchema.version) }
            }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheet: vi.fn().mockResolvedValue({
                properties: { title: "Ski Trip 2026" },
                sheets: [
                    { properties: { sheetId: 10, title: "Expenses" } },
                    { properties: { sheetId: 11, title: "Settlements" } },
                    { properties: { sheetId: 12, title: "Members" } },
                    { properties: { sheetId: 13, title: "Categories" } }
                ]
            }),
            batchGet: vi.fn().mockResolvedValue({
                valueRanges: [
                    { values: [["id", "description", "amount", "category", "date", "paidByUserId", "splits", "createdAt", "updatedAt"]] },
                    { values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes", "updatedAt"]] },
                    { values: [["userId", "email", "name", "role", "joinedAt", "updatedAt"]] },
                    { values: [["id", "name", "icon", "description", "updatedAt"]] }
                ]
            }),
            batchUpdate: vi.fn().mockResolvedValue({}),
            createBackup: createBackupSpy
        };
        (service as any).client = mockClient;
        vi.spyOn(service, "checkHealth").mockResolvedValue({
            spreadsheetId: "ski-trip-sheet",
            currentVersion: QuozenSchema.version,
            latestVersion: QuozenSchema.version,
            status: ValidationStatus.CORRUPTED,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: false,
            lastModifiedTime: new Date().toISOString()
        });

        await service.repairFile("ski-trip-sheet");

        expect(createBackupSpy).toHaveBeenCalledWith("ski-trip-sheet");
    });

    it("createBackup uses spreadsheet title and timestamp to name backup file in Google Drive", async () => {
        const service = new ValidationService(() => "test-token");
        const requestSpy = vi.fn().mockResolvedValue({ id: "drive-copy-file-123" });
        const mockClient = {
            request: requestSpy,
            getSpreadsheet: vi.fn().mockResolvedValue({
                properties: { title: "Vacation Trip" }
            })
        };
        (service as any).client = mockClient;

        const backupId = await service.createBackup("spreadsheet-xyz");
        expect(backupId).toBe("drive-copy-file-123");
        expect(requestSpy).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = requestSpy.mock.calls[0];
        expect(calledUrl).toBe("https://www.googleapis.com/drive/v3/files/spreadsheet-xyz/copy");
        const body = JSON.parse(calledInit.body);
        expect(body.name).toMatch(/^Backup of Vacation Trip - \d{4}-\d{2}-\d{2}T/);
    });

    it("Sync evaluator correctly maps incompatible provider status to warning and diagnostic", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "incompatible" })).toBe("warning");
        expect(resolveProviderDiagnostic(true, true, "incompatible")).toBe("incompatible");
    });
});
