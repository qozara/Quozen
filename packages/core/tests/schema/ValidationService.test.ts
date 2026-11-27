import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";
import { ConflictError, SchemaIncompatibleError } from "../../src/errors";

describe("ValidationService", () => {
    let service: ValidationService;
    let mockEngine: any;
    let mockClient: any;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new ValidationService(() => "test-token");

        mockEngine = {
            checkHealth: vi.fn(),
            repair: vi.fn(),
            migrate: vi.fn(),
            initializeFile: vi.fn(),
        };

        mockClient = {
            createBackup: vi.fn().mockResolvedValue("backup-123"),
            getFileMetadata: vi.fn().mockResolvedValue({ properties: { quozen_type: "group" }, appProperties: {}, modifiedTime: "2026-01-01T00:00:00.000Z" }),
            getFileAppProperties: vi.fn().mockResolvedValue({ modifiedTime: "2026-01-01T00:00:00.000Z" }),
            updateFileAppProperties: vi.fn().mockResolvedValue({}),
            updateFileProperties: vi.fn().mockResolvedValue({}),
        };

        (service as any).engine = mockEngine;
        (service as any).client = mockClient;
    });

    it("requires a valid token to initialize", () => {
        expect(() => new ValidationService(() => null)).toThrow("requires a valid Google access token");
    });

    it("delegates checkHealth to SchemaEngine with QuozenSchema", async () => {
        mockEngine.checkHealth.mockResolvedValue({
            spreadsheetId: "file123",
            currentVersion: 2,
            latestVersion: 2,
            status: ValidationStatus.READY,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: false,
        });

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.READY);
        expect(mockEngine.checkHealth).toHaveBeenCalledWith("file123", QuozenSchema);
        expect(result.lastModifiedTime).toBeDefined();
    });

    it("returns UPGRADE_REQUIRED when engine reports version behind", async () => {
        mockEngine.checkHealth.mockResolvedValue({
            spreadsheetId: "file123",
            currentVersion: 1,
            latestVersion: 2,
            status: ValidationStatus.UPGRADE_REQUIRED,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: true,
        });

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.UPGRADE_REQUIRED);
        expect(result.canAutoMigrate).toBe(true);
    });

    it("returns CORRUPTED when engine reports structural issues", async () => {
        mockEngine.checkHealth.mockResolvedValue({
            spreadsheetId: "file123",
            currentVersion: 2,
            latestVersion: 2,
            status: ValidationStatus.CORRUPTED,
            missingTabs: ["Categories"],
            missingColumns: {},
            canAutoMigrate: false,
        });

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.CORRUPTED);
        expect(result.missingTabs).toEqual(["Categories"]);
    });

    it("delegates repairFile to engine.repair and updates metadata", async () => {
        mockEngine.repair.mockResolvedValue({ backupFileId: "" });

        await service.repairFile("file123");

        expect(mockEngine.repair).toHaveBeenCalledWith(
            "file123",
            QuozenSchema,
            expect.objectContaining({ migrations: expect.any(Array) }),
            expect.any(Array)
        );
        expect(mockClient.updateFileProperties).toHaveBeenCalledWith("file123", expect.objectContaining({
            appProperties: expect.objectContaining({
                quozen_validation_status: ValidationStatus.READY,
            }),
        }));
    });

    it("throws ConflictError on repairFile if sheet was modified after expected timestamp", async () => {
        mockEngine.repair.mockRejectedValue(new ConflictError("Modified remotely"));

        await expect(
            service.repairFile("file123", "2026-01-01T00:00:00.000Z")
        ).rejects.toThrow(ConflictError);

        expect(mockEngine.repair).toHaveBeenCalledWith(
            "file123",
            QuozenSchema,
            expect.objectContaining({ expectedLastModified: "2026-01-01T00:00:00.000Z" }),
            expect.any(Array)
        );
    });

    it("converts engine incompatible error to SchemaIncompatibleError on repairFile", async () => {
        mockEngine.repair.mockRejectedValue(new Error("Cannot repair incompatible schema"));

        await expect(service.repairFile("file123")).rejects.toThrow(SchemaIncompatibleError);
    });

    it("delegates migrateFile to engine.migrate and updates metadata", async () => {
        mockEngine.migrate.mockResolvedValue({ success: true, applied: [2], backupFileId: "" });

        await service.migrateFile("file123");

        expect(mockEngine.migrate).toHaveBeenCalledWith(
            "file123",
            QuozenSchema,
            expect.any(Array),
            expect.any(Object)
        );
        expect(mockClient.updateFileProperties).toHaveBeenCalledWith("file123", expect.objectContaining({
            appProperties: expect.objectContaining({
                quozen_validation_status: ValidationStatus.READY,
            }),
        }));
    });

    it("deduplicates concurrent in-flight migrateFile calls for the same spreadsheet ID", async () => {
        let resolveMigration: () => void;
        const migrationPromise = new Promise<{ success: boolean; applied: number[]; backupFileId: string }>((resolve) => {
            resolveMigration = () => resolve({ success: true, applied: [2], backupFileId: "" });
        });
        mockEngine.migrate.mockReturnValue(migrationPromise);

        const call1 = service.migrateFile("concurrent-sheet-123");
        const call2 = service.migrateFile("concurrent-sheet-123");

        resolveMigration!();
        await Promise.all([call1, call2]);

        expect(mockEngine.migrate).toHaveBeenCalledTimes(1);
    });

    it("delegates initializeFile to engine.initializeFile and updates metadata", async () => {
        mockEngine.initializeFile.mockResolvedValue(undefined);

        await service.initializeFile("file123");

        expect(mockEngine.initializeFile).toHaveBeenCalledWith(
            "file123",
            expect.objectContaining({ version: QuozenSchema.version }),
            undefined
        );
        expect(mockClient.updateFileProperties).toHaveBeenCalledWith("file123", expect.objectContaining({
            appProperties: expect.objectContaining({
                quozen_validation_status: ValidationStatus.READY,
            }),
        }));
    });

    it("delegates createBackup to client.createBackup", async () => {
        const backupId = await service.createBackup("file123", "Custom Backup");
        expect(mockClient.createBackup).toHaveBeenCalledWith("file123", "Custom Backup");
        expect(backupId).toBe("backup-123");
    });
});
