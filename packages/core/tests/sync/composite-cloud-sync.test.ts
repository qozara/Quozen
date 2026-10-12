import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    CompositeCloudSyncProvider,
    GoogleDriveBlobDriver,
    GoogleSheetsTabularDriver,
    type SyncStatus
} from "../../src/sync";

describe("Phase 2: Composite Cloud Sync Provider & Storage Drivers (Quomida Pattern)", () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
    });

    it("GoogleDriveBlobDriver reads and writes user_settings to spaces=appDataFolder", async () => {
        const driver = new GoogleDriveBlobDriver({
            getAccessToken: () => "mock-token",
            httpClient: { fetch: mockFetch as any }
        });

        // 1. Simulate file existing in appDataFolder
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ files: [{ id: "appdata-file-1", name: "quozen-settings.json" }] })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    id: "global_settings",
                    version: 1,
                    activeGroupId: "group-1",
                    groupCache: [{ id: "group-1", name: "Trip", role: "owner" }],
                    preferences: { defaultCurrency: "USD" },
                    lastUpdated: "2026-10-11T00:00:00.000Z",
                    updatedAt: "2026-10-11T00:00:00.000Z"
                })
            });

        const settings = await driver.readBlob("quozen-settings.json");
        expect(settings).not.toBeNull();
        expect(settings.activeGroupId).toBe("group-1");

        // Verify spaces=appDataFolder was queried
        const firstCallUrl = String(mockFetch.mock.calls[0][0]);
        expect(firstCallUrl).toContain("spaces=appDataFolder");
    });

    it("GoogleDriveBlobDriver automatically migrates legacy root quozen-settings.json into appDataFolder", async () => {
        const driver = new GoogleDriveBlobDriver({
            getAccessToken: () => "mock-token",
            httpClient: { fetch: mockFetch as any }
        });

        const legacySettings = {
            version: 1,
            activeGroupId: "legacy-group-1",
            groupCache: [{ id: "legacy-group-1", name: "Legacy Group", role: "owner" }],
            preferences: { defaultCurrency: "EUR" },
            lastUpdated: "2026-01-01T00:00:00.000Z"
        };

        mockFetch
            // 1. Search appDataFolder -> empty
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ files: [] })
            })
            // 2. Search root Drive -> found legacy file!
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ files: [{ id: "root-legacy-id", name: "quozen-settings.json" }] })
            })
            // 3. Read legacy file content
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => legacySettings
            })
            // 4. Write migrated settings into appDataFolder (check existing in appDataFolder -> empty)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ files: [] })
            })
            // 5. Multipart POST to appDataFolder
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ id: "new-appdata-id" })
            });

        const migrated = await driver.readBlob("quozen-settings.json");
        expect(migrated).not.toBeNull();
        expect(migrated.activeGroupId).toBe("legacy-group-1");
        expect(migrated.preferences.defaultCurrency).toBe("EUR");

        // Verify multipart upload to appDataFolder occurred
        const uploadCall = mockFetch.mock.calls[4];
        expect(String(uploadCall[0])).toContain("upload/drive/v3/files?uploadType=multipart");
        expect(String(uploadCall[1].body)).toContain("appDataFolder");
    });

    it("CompositeCloudSyncProvider routes user_settings to BlobStorageDriver and group collections to TabularStorageDriver", async () => {
        const mockBlobDriver = {
            id: "mock-blob",
            name: "Mock Blob",
            readBlob: vi.fn().mockResolvedValue([
                {
                    id: "global_settings",
                    version: 1,
                    activeGroupId: "group-123",
                    groupCache: [{ id: "group-123", name: "Vacation", role: "owner" }],
                    preferences: { defaultCurrency: "USD" },
                    lastUpdated: "2026-10-11T00:00:00.000Z",
                    updatedAt: "2026-10-11T00:00:00.000Z"
                }
            ]),
            writeBlob: vi.fn().mockResolvedValue(undefined)
        };

        const mockTabularDriver = {
            id: "mock-tabular",
            name: "Mock Tabular",
            readTable: vi.fn().mockImplementation(async (docId: string, tabName: string) => {
                if (docId === "group-123" && tabName === "Expenses") {
                    return [
                        {
                            id: "exp-1",
                            headers: ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
                            values: [
                                "exp-1",
                                "2026-10-10T12:00:00.000Z",
                                "Pizza",
                                40,
                                "u1",
                                "Food",
                                JSON.stringify([{ userId: "u1", amount: 20 }, { userId: "u2", amount: 20 }]),
                                JSON.stringify({ createdAt: "2026-10-10T12:00:00.000Z", lastModified: "2026-10-10T12:00:00.000Z" })
                            ]
                        }
                    ];
                }
                return [];
            }),
            writeTable: vi.fn().mockResolvedValue(undefined)
        };

        const provider = new CompositeCloudSyncProvider({
            id: "test-composite",
            name: "Test Composite Provider",
            blobDriver: mockBlobDriver,
            tabularDriver: mockTabularDriver
        });

        const statuses: SyncStatus[] = [];
        provider.onStatusChange(s => statuses.push(s));

        await provider.initialize();
        expect(provider.isInitialized()).toBe(true);
        expect(provider.getStatus()).toBe("idle");

        // 1. Pull for group-123
        const pulled = await provider.pull("group-123");
        const settingsPayload = pulled.find(p => p.collection === "user_settings");
        const expensesPayload = pulled.find(p => p.collection === "expenses");

        expect(settingsPayload?.documents).toHaveLength(1);
        expect(settingsPayload?.documents[0].activeGroupId).toBe("group-123");
        expect(expensesPayload?.documents).toHaveLength(1);
        expect(expensesPayload?.documents[0].id).toBe("exp-1");
        expect(expensesPayload?.documents[0].groupId).toBe("group-123");
        expect(expensesPayload?.documents[0].description).toBe("Pizza");

        // 2. Push user_settings -> routes to blobDriver
        await provider.push({
            collection: "user_settings",
            documents: [
                {
                    id: "global_settings",
                    version: 1,
                    activeGroupId: "group-123",
                    groupCache: [],
                    preferences: { defaultCurrency: "ARS" },
                    lastUpdated: "2026-10-11T01:00:00.000Z",
                    updatedAt: "2026-10-11T01:00:00.000Z"
                }
            ]
        });
        expect(mockBlobDriver.writeBlob).toHaveBeenCalledWith(
            "quozen-settings.json",
            expect.arrayContaining([expect.objectContaining({ id: "global_settings" })])
        );

        // 3. Push expenses -> routes to tabularDriver for group-123
        await provider.push({
            collection: "expenses",
            groupId: "group-123",
            documents: [
                {
                    id: "exp-2",
                    groupId: "group-123",
                    description: "Gelato",
                    amount: 12,
                    category: "Food",
                    date: "2026-10-11T15:00:00.000Z",
                    paidByUserId: "u2",
                    splits: [{ userId: "u1", amount: 6 }, { userId: "u2", amount: 6 }],
                    createdAt: "2026-10-11T15:00:00.000Z",
                    updatedAt: "2026-10-11T15:00:00.000Z",
                    deletedAt: null
                }
            ]
        });

        expect(mockTabularDriver.writeTable).toHaveBeenCalledWith(
            "group-123",
            "Expenses",
            expect.any(Array),
            expect.arrayContaining([
                expect.objectContaining({ id: "exp-1" }),
                expect.objectContaining({ id: "exp-2" })
            ])
        );
        expect(statuses).toContain("syncing");
        expect(provider.getStatus()).toBe("idle");
    });
});
