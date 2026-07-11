import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ValidationService, ValidationStatus } from "../../src/schema/ValidationService";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";

describe("Migrations & Schema Edge Cases", () => {
    let mockStorage: any;
    let mockUser: any;
    let fakeSettings: any;

    beforeEach(() => {
        vi.clearAllMocks();

        fakeSettings = {
            version: 1,
            activeGroupId: null,
            groupCache: [],
            preferences: { defaultCurrency: "USD" },
            lastUpdated: ""
        };

        mockUser = { id: "u1", email: "u1@test.com", name: "User 1" };

        mockStorage = {
            getFile: vi.fn(),
            getSpreadsheet: vi.fn(),
            batchGetValues: vi.fn().mockResolvedValue([{ values: [] }]),
            updateFile: vi.fn().mockImplementation(async (_id: string, _opts: any, data?: string) => {
                if (data) {
                    fakeSettings = JSON.parse(data);
                }
            }),
            listFiles: vi.fn().mockImplementation(async (query: string) => {
                if (query.includes("quozen-settings.json")) {
                    return [{ id: "settings123", name: "quozen-settings.json" }];
                }
                return [];
            }),
            createFile: vi.fn().mockImplementation(async (_name: string, _type: string, _opts: any, data: string) => {
                fakeSettings = JSON.parse(data);
            }),
        };

        mockStorage.getFile.mockImplementation(async (id: string, opts: any) => {
            if (id === "settings123") {
                return fakeSettings;
            }
            if (opts?.fields === "appProperties") {
                return { appProperties: {} }; // No version info
            }
            return { name: "Group File", properties: { quozen_type: "group" } };
        });

        vi.spyOn(ValidationService.prototype, "inspectFile").mockResolvedValue(ValidationStatus.UP_TO_DATE);
        vi.spyOn(ValidationService.prototype, "initializeFile").mockResolvedValue();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should handle legacy files without versioning info (Valid structure)", async () => {
        mockStorage.getSpreadsheet.mockResolvedValue({
            properties: { title: "Legacy Group" },
            sheets: [
                { properties: { title: "Expenses" } },
                { properties: { title: "Settlements" } },
                { properties: { title: "Members" } }
            ]
        });

        const repo = new GroupRepository(mockStorage, mockUser, () => "fake-token");
        
        await repo.importGroup("legacy123");

        expect(ValidationService.prototype.initializeFile).toHaveBeenCalledWith("legacy123");
        
        const settings = await repo.getSettings();
        expect(settings.activeGroupId).toBe("legacy123");
        expect(settings.groupCache[0].id).toBe("legacy123");
        expect(settings.groupCache[0].validationStatus).toBe(ValidationStatus.UP_TO_DATE);
    });

    it("should not activate an OUT_OF_SYNC group when importing", async () => {
        mockStorage.getSpreadsheet.mockResolvedValue({
            properties: { title: "Corrupted Group" },
            sheets: [
                { properties: { title: "Expenses" } },
            ]
        });

        vi.spyOn(ValidationService.prototype, "inspectFile").mockResolvedValue(ValidationStatus.OUT_OF_SYNC);

        const repo = new GroupRepository(mockStorage, mockUser, () => "fake-token");
        
        await repo.importGroup("corrupted123");

        const settings = await repo.getSettings();
        expect(settings.activeGroupId).toBeNull();
        expect(settings.groupCache[0].id).toBe("corrupted123");
        expect(settings.groupCache[0].validationStatus).toBe(ValidationStatus.OUT_OF_SYNC);
    });

    it("should prevent updating active group to an OUT_OF_SYNC group", async () => {
        mockStorage.getSpreadsheet.mockResolvedValue({
            properties: { title: "Corrupted Group" },
            sheets: [{ properties: { title: "Expenses" } }]
        });
        
        const repo = new GroupRepository(mockStorage, mockUser, () => "fake-token");
        
        fakeSettings = {
            version: 1,
            activeGroupId: "valid123",
            groupCache: [{ id: "corrupted123", name: "Corrupt", role: "owner" }],
            preferences: { defaultCurrency: "USD" },
            lastUpdated: ""
        };

        await expect(repo.updateActiveGroup("corrupted123")).rejects.toThrow("Cannot activate an out-of-sync group. Please repair it first.");
    });
});
