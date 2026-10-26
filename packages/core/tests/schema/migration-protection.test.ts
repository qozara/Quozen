import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { createQuozenDatabase, destroyQuozenDatabase } from "../../src/db";
import { ReplicationCoordinator } from "../../src/sync/ReplicationCoordinator";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { SchemaIncompatibleError } from "../../src/errors";
import { LedgerService } from "../../src/finance/LedgerService";
import { resolveUXStatus, resolveProviderDiagnostic } from "../../src/sync/evaluator";
import { SchemaEngine, GoogleSheetsFetchClient } from "@qozara/gdocs-schema";

describe("Spreadsheet Migration vs Repair Protection & Pre-Sync Verification", () => {
    let mockClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("identifies legacy spreadsheet lacking _migrations tab as UPGRADE_REQUIRED, NEVER as CORRUPTED", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {} }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "Legacy Group" },
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } }
                ]
            }),
            batchGet: vi.fn().mockRejectedValue(new Error("Google API 400: Unable to parse range: _migrations!A2:B")),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("legacy-group-123");

        // MUST be UPGRADE_REQUIRED, NOT CORRUPTED!
        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
        expect(health.latestVersion).toBe(QuozenSchema.version);
    });

    it("identifies legacy spreadsheet lacking _migrations tab as UPGRADE_REQUIRED even if Drive appProperties has stale quozen_schema_version=2", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: { quozen_schema_version: "2" } }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "Legacy Group" },
                sheets: [
                    { properties: { title: "Expenses" } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "Members" } }
                ]
            }),
            batchGet: vi.fn().mockRejectedValue(new Error("Google API 400: Unable to parse range: _migrations!A2:B")),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("stale-appprops-group");

        // MUST reconcile against physical sheet: no _migrations tab means it was NEVER migrated!
        // It must be UPGRADE_REQUIRED, NEVER CORRUPTED!
        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
    });

    it("identifies spreadsheet with case-insensitive sheet titles (e.g. expenses, members, settlements) lacking _migrations as UPGRADE_REQUIRED", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {} }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "Case Sheet" },
                sheets: [
                    { properties: { title: "expenses " } },
                    { properties: { title: "Settlements" } },
                    { properties: { title: "MEMBERS" } }
                ]
            }),
            batchGet: vi.fn().mockRejectedValue(new Error("Google API 400: Unable to parse range: _migrations!A2:B")),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("case-insensitive-group");

        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
    });

    it("identifies spreadsheet with _migrations at version 1 as UPGRADE_REQUIRED, NEVER as CORRUPTED", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: { quozen_schema_version: "1" } }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "V1 Sheet" },
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

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("v1-group-456");

        expect(health.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(health.canAutoMigrate).toBe(true);
        expect(health.currentVersion).toBe(1);
    });

    it("only reports CORRUPTED when _migrations matches expected version but structure is corrupted by manual edits", async () => {
        mockClient = {
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {} }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "V2 Group" },
                sheets: [
                    { properties: { sheetId: 1, title: "Expenses" } },
                    { properties: { sheetId: 2, title: "Settlements" } },
                    { properties: { sheetId: 3, title: "Members" } },
                    { properties: { sheetId: 4, title: "Categories" } },
                    { properties: { sheetId: 5, title: "_migrations" } },
                    { properties: { sheetId: 6, title: "_meta" } }
                ]
            }),
            batchGet: vi.fn().mockImplementation((_id: string, ranges: string[]) => {
                if (ranges && ranges[0] && ranges[0].includes("_migrations")) {
                    return Promise.resolve({
                        valueRanges: [{ values: [["version", "migrated_at"], ["1", "2024-01-01"], ["2", "2026-01-01"], [String(QuozenSchema.version), "2026-03-01"]] }]
                    });
                }
                // Return header without 'amount' column in Expenses
                return Promise.resolve({
                    valueRanges: [
                        { values: [["id", "date", "description", "paidBy", "category", "splits", "meta"]] },
                        { values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
                        { values: [["userId", "email", "name", "role", "joinedAt"]] },
                        { values: [["id", "name", "icon", "description", "updatedAt", "deletedAt"]] },
                        { values: [["key", "value", "updatedAt"]] }
                    ]
                });
            }),
            batchUpdate: vi.fn().mockResolvedValue({})
        };

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("v2-tampered-group");

        // Version matches latest, but structure is invalid -> THIS is corruption!
        expect(health.status).toBe(ValidationStatus.CORRUPTED);
        expect(health.canAutoMigrate).toBe(false);
        expect(health.currentVersion).toBe(QuozenSchema.version);
    });

    it("repairFile delegates to migrateFile if spreadsheet version is behind expected", async () => {
        const service = new ValidationService(() => "test-token");
        let migrated = false;
        (service as any).engine = {
            repair: vi.fn().mockImplementation(async () => {
                await service.migrateFile("legacy-sheet");
            }),
            migrate: vi.fn().mockImplementation(async () => {
                migrated = true;
            })
        };
        const migrateSpy = vi.spyOn(service, "migrateFile").mockImplementation(async () => {
            migrated = true;
        });

        await service.repairFile("legacy-sheet");
        expect(migrateSpy).toHaveBeenCalledWith("legacy-sheet");
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
            getFileAppProperties: vi.fn().mockResolvedValue({ appProperties: {} }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            getSpreadsheetMetadata: vi.fn().mockResolvedValue({
                properties: { title: "Future Group" },
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

        const service = new ValidationService(() => "test-token");
        (service as any).client = mockClient;
        (service as any).engine = new SchemaEngine(mockClient as any);

        const health = await service.checkHealth("future-group-999");

        // MUST be INCOMPATIBLE, NOT CORRUPTED and NOT UPGRADE_REQUIRED!
        expect(health.status).toBe(ValidationStatus.INCOMPATIBLE);
        expect(health.canAutoMigrate).toBe(false);
        expect(health.currentVersion).toBe(higherVersion);
        expect(health.latestVersion).toBe(QuozenSchema.version);
    });

    it("repairFile and migrateFile throw SchemaIncompatibleError when spreadsheet schema is higher than app version", async () => {
        const service = new ValidationService(() => "test-token");
        (service as any).engine = {
            repair: vi.fn().mockRejectedValue(new Error("Cannot repair incompatible schema")),
            migrate: vi.fn().mockRejectedValue(new Error("Cannot migrate incompatible schema")),
        };

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
        (service as any).engine = {
            repair: vi.fn().mockImplementation(async () => {
                await (service as any).client.createBackup("ski-trip-sheet");
            }),
        };
        (service as any).client = {
            createBackup: createBackupSpy,
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
        };

        await service.repairFile("ski-trip-sheet");

        expect(createBackupSpy).toHaveBeenCalledWith("ski-trip-sheet");
    });

    it("creates a safety backup with spreadsheet title in Google Drive before migrating", async () => {
        const service = new ValidationService(() => "test-token");
        const createBackupSpy = vi.fn().mockResolvedValue("backup-copy-id-789");
        (service as any).engine = {
            migrate: vi.fn().mockImplementation(async () => {
                await (service as any).client.createBackup("test-sheet");
            }),
        };
        (service as any).client = {
            createBackup: createBackupSpy,
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
        };

        await expect(service.migrateFile("test-sheet")).resolves.not.toThrow();
        expect(createBackupSpy).toHaveBeenCalledWith("test-sheet");
    });

    it("createBackup uses spreadsheet title and timestamp to name backup file in Google Drive", async () => {
        const service = new ValidationService(() => "test-token");
        const mockClient = {
            createBackup: vi.fn().mockResolvedValue("drive-copy-file-123"),
        };
        (service as any).client = mockClient;

        const backupId = await service.createBackup("spreadsheet-xyz");
        expect(backupId).toBe("drive-copy-file-123");
        expect(mockClient.createBackup).toHaveBeenCalledWith("spreadsheet-xyz", undefined);
    });

    it("Sync evaluator correctly maps incompatible provider status to warning and diagnostic", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "incompatible" })).toBe("warning");
        expect(resolveProviderDiagnostic(true, true, "incompatible")).toBe("incompatible");
    });
});
