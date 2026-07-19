import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { QuozenSchema } from "../../src/schema/SchemaDefinition";

// Mock the entire gdocs-schema module
vi.mock("@qozara/gdocs-schema", async () => {
    const actual = await vi.importActual("@qozara/gdocs-schema") as any;
    return {
        ...actual,
        SchemaValidator: vi.fn(),
        MigrationManager: vi.fn(),
        GoogleSheetsFetchClient: vi.fn(),
    };
});

import { SchemaValidator, MigrationManager, GoogleSheetsFetchClient } from "@qozara/gdocs-schema";

describe("ValidationService", () => {
    let mockClient: any;
    let mockValidator: any;
    let mockMigrationManager: any;
    let service: ValidationService;

    beforeEach(() => {
        vi.clearAllMocks();

        mockClient = {
            getFileAppProperties: vi.fn(),
            updateFileAppProperties: vi.fn(),
            batchUpdate: vi.fn().mockResolvedValue({ replies: [{ addSheet: { properties: { sheetId: 123 } } }] }),
        };
        (GoogleSheetsFetchClient as any).mockImplementation(function() { return mockClient; });

        mockValidator = {
            validateStructure: vi.fn(),
        };
        (SchemaValidator as any).mockImplementation(function() { return mockValidator; });

        mockMigrationManager = {
            initializeSchema: vi.fn(),
            repairStructure: vi.fn(),
            runMigrations: vi.fn(),
        };
        (MigrationManager as any).mockImplementation(function() { return mockMigrationManager; });

        service = new ValidationService(() => "test-token");
    });

    it("requires a valid token to initialize", () => {
        expect(() => new ValidationService(() => null)).toThrow("requires a valid Google access token");
    });

    it("returns READY if the validator passes", async () => {
        mockValidator.validateStructure.mockResolvedValue({ valid: true });

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.READY);
        expect(mockValidator.validateStructure).toHaveBeenCalledWith("file123", QuozenSchema);
    });

    it("returns UPGRADE_REQUIRED if the validator fails but version is known and older", async () => {
        mockValidator.validateStructure.mockResolvedValue({ valid: false });
        
        // Temporarily override QuozenSchema.version to test the logic
        const originalVersion = QuozenSchema.version;
        (QuozenSchema as any).version = 2;
        
        mockClient.getFileAppProperties.mockResolvedValueOnce({
            appProperties: { quozen_schema_version: "1" }
        });

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.UPGRADE_REQUIRED);

        // Restore
        (QuozenSchema as any).version = originalVersion;
    });

    it("returns CORRUPTED if validator fails and version is unknown or empty", async () => {
        mockValidator.validateStructure.mockResolvedValue({ valid: false });
        mockClient.getFileAppProperties.mockRejectedValue(new Error("No properties"));

        const result = await service.checkHealth("file123");
        expect(result.status).toBe(ValidationStatus.CORRUPTED);
    });

    it("initializes file and updates metadata", async () => {
        await service.initializeFile("file123");
        expect(mockClient.batchUpdate).toHaveBeenCalled();
        expect(mockClient.updateFileAppProperties).toHaveBeenCalledWith("file123", expect.objectContaining({
            quozen_validation_status: ValidationStatus.READY,
            quozen_schema_version: QuozenSchema.version.toString()
        }));
    });
});
