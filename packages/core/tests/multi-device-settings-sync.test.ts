import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import {
    createQuozenDatabase,
    destroyQuozenDatabase,
    type QuozenDatabase
} from "../src/db";
import {
    CompositeCloudSyncProvider,
    GoogleDriveBlobDriver,
    GoogleSheetsTabularDriver,
    ReplicationCoordinator,
    mergeUserSettingsDocs
} from "../src/sync";
import { InMemoryAdapter } from "../src/storage/memory-adapter";
import { GroupRepository } from "../src/infrastructure/GroupRepository";
import { User, UserSettings } from "../src/domain/models";
import { ValidationStatus } from "../src/schema/ValidationService";
import { SETTINGS_FILE_NAME, QUOZEN_PREFIX } from "../src/types";
import { TableNotFoundError } from "../src/errors";

describe("Phase 1, 2, 3: Multi-Device Settings Sync & Isolation Test Suite", () => {
    let dbA: QuozenDatabase | null = null;
    let dbB: QuozenDatabase | null = null;
    let sharedCloudStorage: InMemoryAdapter;

    const user: User = {
        id: "user-123",
        username: "user123",
        email: "user@example.com",
        name: "Test User"
    };

    beforeEach(async () => {
        sharedCloudStorage = new InMemoryAdapter();
        const randA = Math.random().toString(36).slice(2);
        const randB = Math.random().toString(36).slice(2);
        dbA = await createQuozenDatabase({
            name: `test_dev_a_${Date.now()}_${randA}`,
            storage: getRxStorageMemory()
        });
        dbB = await createQuozenDatabase({
            name: `test_dev_b_${Date.now()}_${randB}`,
            storage: getRxStorageMemory()
        });
    });

    afterEach(async () => {
        if (dbA) {
            await destroyQuozenDatabase(dbA);
            dbA = null;
        }
        if (dbB) {
            await destroyQuozenDatabase(dbB);
            dbB = null;
        }
        vi.restoreAllMocks();
    });

    function createProviders(storage: InMemoryAdapter, activeGroupId?: string) {
        const blobDriverA = new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: storage });
        const tabularDriverA = new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: storage });
        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: blobDriverA,
            tabularDriver: tabularDriverA,
            activeGroupId
        });

        const blobDriverB = new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: storage });
        const tabularDriverB = new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: storage });
        const providerB = new CompositeCloudSyncProvider({
            id: "gdrive-b",
            name: "Google Drive B",
            blobDriver: blobDriverB,
            tabularDriver: tabularDriverB,
            activeGroupId
        });

        return { blobDriverA, tabularDriverA, providerA, blobDriverB, tabularDriverB, providerB };
    }

    it("1. Device A -> Device B Initial Handoff: seeds active group & preferences onto uninitialized Device B", async () => {
        const { blobDriverA, providerA, blobDriverB, providerB } = createProviders(sharedCloudStorage);
        await providerA.initialize();
        await providerB.initialize();

        const coordA = new ReplicationCoordinator(dbA!, providerA);
        const coordB = new ReplicationCoordinator(dbB!, providerB);

        const groupRepoA = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbA!,
            blobDriverA,
            () => coordA.sync()
        );

        // 1. Device A sets preferences & creates Group 2
        const group2 = await groupRepoA.create("Group 2");
        const settingsA = await groupRepoA.getSettings();
        settingsA.preferences = {
            defaultCurrency: "EUR",
            locale: "es",
            aiProvider: "byok"
        };
        settingsA.activeGroupId = group2.id;
        await groupRepoA.saveSettings(settingsA);

        // Device A syncs to cloud
        await coordA.sync(group2.id);

        // 2. Device B is fresh (no local settings). It connects and syncs
        await coordB.sync();

        const groupRepoB = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbB!,
            blobDriverB,
            () => coordB.sync()
        );

        const settingsB = await groupRepoB.getSettings();
        expect(settingsB.preferences.defaultCurrency).toBe("EUR");
        expect(settingsB.preferences.locale).toBe("es");
        expect(settingsB.preferences.aiProvider).toBe("byok");
        expect(settingsB.activeGroupId).toBe(group2.id);
        expect(settingsB.groupCache.some(g => g.id === group2.id)).toBe(true);
    });

    it("2. Multi-device independent active groups + shared preferences sync", async () => {
        const { blobDriverA, providerA, blobDriverB, providerB } = createProviders(sharedCloudStorage);
        await providerA.initialize();
        await providerB.initialize();

        const coordA = new ReplicationCoordinator(dbA!, providerA);
        const coordB = new ReplicationCoordinator(dbB!, providerB);

        const groupRepoA = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbA!,
            blobDriverA,
            () => coordA.sync()
        );
        const groupRepoB = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbB!,
            blobDriverB,
            () => coordB.sync()
        );

        // Create Group 1 and Group 2
        const g1 = await groupRepoA.create("Group 1");
        const g2 = await groupRepoA.create("Group 2");
        await coordA.sync();

        // Device B syncs both groups
        await coordB.sync();

        // Device A switches to Group 1
        await groupRepoA.updateActiveGroup(g1.id);

        // Device B switches to Group 2
        await groupRepoB.updateActiveGroup(g2.id);

        // Device A updates currency to GBP
        const settingsA = await groupRepoA.getSettings();
        settingsA.preferences.defaultCurrency = "GBP";
        await groupRepoA.saveSettings(settingsA);

        // Both devices sync
        await coordA.sync(g1.id);
        await coordB.sync(g2.id);
        await coordA.sync(g1.id);

        // Verify: both devices have GBP
        const afterA = await groupRepoA.getSettings();
        const afterB = await groupRepoB.getSettings();

        expect(afterA.preferences.defaultCurrency).toBe("GBP");
        expect(afterB.preferences.defaultCurrency).toBe("GBP");

        // Verify: Device A is STILL on Group 1, Device B is STILL on Group 2
        expect(afterA.activeGroupId).toBe(g1.id);
        expect(afterB.activeGroupId).toBe(g2.id);
    });

    it("3. Concurrent open devices editing preferences with LWW", async () => {
        const t1 = new Date("2026-06-01T10:00:00.000Z").toISOString();
        const t2 = new Date("2026-06-01T10:05:00.000Z").toISOString(); // newer

        const localDocA = {
            id: "global_settings",
            version: 1,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "G1", role: "owner", lastAccessed: t1 }],
            preferences: { defaultCurrency: "EUR" },
            preferencesUpdatedAt: t1,
            updatedAt: t1
        };

        const localDocB = {
            id: "global_settings",
            version: 1,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "G1", role: "owner", lastAccessed: t2 }],
            preferences: { defaultCurrency: "JPY" },
            preferencesUpdatedAt: t2,
            updatedAt: t2
        };

        // When Device B merges with Device A's doc, t2 > t1, so JPY wins
        const mergeResult = mergeUserSettingsDocs(localDocB, localDocA);
        expect(mergeResult.mergedDoc.preferences.defaultCurrency).toBe("JPY");
        expect(mergeResult.shouldPushRemote).toBe(true);

        // When Device A pulls Device B's doc, t2 > t1, so JPY wins and updates local
        const mergeResultA = mergeUserSettingsDocs(localDocA, mergeResult.mergedDoc);
        expect(mergeResultA.mergedDoc.preferences.defaultCurrency).toBe("JPY");
        expect(mergeResultA.shouldUpdateLocal).toBe(true);
    });

    it("3b. mergeUserSettingsDocs preserves and merges archivedGroupCache across devices", () => {
        const t1 = new Date(Date.now() - 20000).toISOString();
        const t2 = new Date(Date.now() - 10000).toISOString();

        const localDocA = {
            id: "global_settings",
            version: 3,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "Active Group", role: "owner", updatedAt: t1, lastAccessed: t1 }],
            archivedGroupCache: [
                { id: "g-archived-1", name: "Trip 2024", role: "owner", updatedAt: t1, lastAccessed: t1, icon: "preset:plane" }
            ],
            preferences: { defaultCurrency: "USD" },
            updatedAt: t1
        };

        const remoteDocB = {
            id: "global_settings",
            version: 3,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "Active Group", role: "owner", updatedAt: t2, lastAccessed: t2 }],
            archivedGroupCache: [
                { id: "g-archived-2", name: "House 2025", role: "owner", updatedAt: t2, lastAccessed: t2, icon: "preset:home" }
            ],
            preferences: { defaultCurrency: "USD" },
            updatedAt: t2
        };

        const result = mergeUserSettingsDocs(localDocA, remoteDocB);
        expect(result.mergedDoc.archivedGroupCache).toBeDefined();
        expect(result.mergedDoc.archivedGroupCache.length).toBe(2);
        const ids = result.mergedDoc.archivedGroupCache.map((g: any) => g.id);
        expect(ids).toContain("g-archived-1");
        expect(ids).toContain("g-archived-2");
    });

    it("3c. mergeUserSettingsDocs preserves group icon when one doc has icon and the other has newer updatedAt", () => {
        const t1 = new Date(Date.now() - 20000).toISOString();
        const t2 = new Date(Date.now() - 10000).toISOString();

        // Local has icon set at t1
        const localDocA = {
            id: "global_settings",
            version: 3,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "Active Group", role: "owner", icon: "preset:utensils", updatedAt: t1, lastAccessed: t1 }],
            preferences: { defaultCurrency: "USD" },
            updatedAt: t1
        };

        // Remote doc was updated at t2 by an older client that didn't know about icons
        const remoteDocB = {
            id: "global_settings",
            version: 2,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "Active Group Renamed", role: "owner", updatedAt: t2, lastAccessed: t2 }],
            preferences: { defaultCurrency: "USD" },
            updatedAt: t2
        };

        const result = mergeUserSettingsDocs(localDocA, remoteDocB);
        const mergedG1 = result.mergedDoc.groupCache.find((g: any) => g.id === "g1");
        expect(mergedG1).toBeDefined();
        // Should keep the newer name from remote AND retain the icon from local
        expect(mergedG1.name).toBe("Active Group Renamed");
        expect(mergedG1.icon).toBe("preset:utensils");
    });

    it("3d. mergeUserSettingsDocs preserves local unarchive when remote doc still has group in archivedGroupCache", () => {
        const tCreated = new Date(Date.now() - 30000).toISOString();
        const tArchivedRemote = new Date(Date.now() - 20000).toISOString();
        const tUnarchivedLocal = new Date(Date.now() - 5000).toISOString();

        // Local unarchived group g1 at tUnarchivedLocal
        const localDoc = {
            id: "global_settings",
            version: 3,
            activeGroupId: "g1",
            groupCache: [
                { id: "g1", name: "Trip", role: "owner" as const, updatedAt: tUnarchivedLocal, lastAccessed: tUnarchivedLocal, isArchived: false }
            ],
            archivedGroupCache: [],
            preferences: { defaultCurrency: "USD" },
            updatedAt: tUnarchivedLocal
        };

        // Remote doc still has g1 in archivedGroupCache from tArchivedRemote
        const remoteDoc = {
            id: "global_settings",
            version: 3,
            activeGroupId: null,
            groupCache: [],
            archivedGroupCache: [
                { id: "g1", name: "Trip", role: "owner" as const, updatedAt: tArchivedRemote, lastAccessed: tArchivedRemote, isArchived: true }
            ],
            preferences: { defaultCurrency: "USD" },
            updatedAt: tArchivedRemote
        };

        const result = mergeUserSettingsDocs(localDoc, remoteDoc);
        expect(result.mergedDoc.groupCache.some((g: any) => g.id === "g1")).toBe(true);
        expect(result.mergedDoc.archivedGroupCache.some((g: any) => g.id === "g1")).toBe(false);
        expect(result.shouldPushRemote).toBe(true);
    });

    it("3e. mergeUserSettingsDocs preserves local archive when remote doc still has group in groupCache", () => {
        const tCreated = new Date(Date.now() - 30000).toISOString();
        const tActiveRemote = new Date(Date.now() - 20000).toISOString();
        const tArchivedLocal = new Date(Date.now() - 5000).toISOString();

        // Local archived group g1 at tArchivedLocal
        const localDoc = {
            id: "global_settings",
            version: 3,
            activeGroupId: null,
            groupCache: [],
            archivedGroupCache: [
                { id: "g1", name: "Trip", role: "owner" as const, updatedAt: tArchivedLocal, lastAccessed: tArchivedLocal, isArchived: true }
            ],
            preferences: { defaultCurrency: "USD" },
            updatedAt: tArchivedLocal
        };

        // Remote doc still has g1 active from tActiveRemote
        const remoteDoc = {
            id: "global_settings",
            version: 3,
            activeGroupId: "g1",
            groupCache: [
                { id: "g1", name: "Trip", role: "owner" as const, updatedAt: tActiveRemote, lastAccessed: tActiveRemote, isArchived: false }
            ],
            archivedGroupCache: [],
            preferences: { defaultCurrency: "USD" },
            updatedAt: tActiveRemote
        };

        const result = mergeUserSettingsDocs(localDoc, remoteDoc);
        expect(result.mergedDoc.archivedGroupCache.some((g: any) => g.id === "g1")).toBe(true);
        expect(result.mergedDoc.groupCache.some((g: any) => g.id === "g1")).toBe(false);
        expect(result.shouldPushRemote).toBe(true);
    });

    it("4. Concurrent group cache additions and deletions", async () => {
        const { blobDriverA, providerA, blobDriverB, providerB } = createProviders(sharedCloudStorage);
        await providerA.initialize();
        await providerB.initialize();

        const coordA = new ReplicationCoordinator(dbA!, providerA);
        const coordB = new ReplicationCoordinator(dbB!, providerB);

        const groupRepoA = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbA!,
            blobDriverA,
            () => coordA.sync()
        );
        const groupRepoB = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbB!,
            blobDriverB,
            () => coordB.sync()
        );

        // Device A creates Group A; Device B creates Group B
        const groupA = await groupRepoA.create("Group A");
        const groupB = await groupRepoB.create("Group B");

        // Sync A then B then A
        await coordA.sync(groupA.id);
        await coordB.sync(groupB.id);
        await coordA.sync(groupA.id);

        const settingsA = await groupRepoA.getSettings();
        const settingsB = await groupRepoB.getSettings();

        // Both devices have both groups
        expect(settingsA.groupCache.some(g => g.id === groupA.id)).toBe(true);
        expect(settingsA.groupCache.some(g => g.id === groupB.id)).toBe(true);
        expect(settingsB.groupCache.some(g => g.id === groupA.id)).toBe(true);
        expect(settingsB.groupCache.some(g => g.id === groupB.id)).toBe(true);

        // Device A deletes Group A
        await groupRepoA.deleteGroup(groupA.id);
        await coordA.sync();

        // Device B syncs -> Group A must be removed from Device B, NOT resurrected!
        await coordB.sync();
        const afterDeleteB = await groupRepoB.getSettings();
        expect(afterDeleteB.groupCache.some(g => g.id === groupA.id)).toBe(false);
    });

    it("5. Auth error on Device B does not clobber cloud settings", async () => {
        const blobDriverA = new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage });
        const groupRepoA = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbA!,
            blobDriverA
        );

        // Device A sets EUR preferences and creates a group in the cloud
        const group1 = await groupRepoA.create("Group 1");
        const settingsA = await groupRepoA.getSettings();
        settingsA.preferences = { defaultCurrency: "EUR" };
        await groupRepoA.saveSettings(settingsA);

        // Device B has an expired token throwing 401
        let tokenExpired = true;
        const mockAuthBlobDriver = {
            id: "auth-blob",
            name: "Auth Blob Driver",
            async readBlob() {
                if (tokenExpired) {
                    const err: any = new Error("Google Auth Failed (401)");
                    err.status = 401;
                    throw err;
                }
                return await blobDriverA.readBlob(SETTINGS_FILE_NAME);
            },
            async writeBlob(filename: string, data: any) {
                if (tokenExpired) {
                    const err: any = new Error("Google Auth Failed (401)");
                    err.status = 401;
                    throw err;
                }
                return await blobDriverA.writeBlob(filename, data);
            },
            async deleteBlob() {}
        };

        const groupRepoB = new GroupRepository(
            sharedCloudStorage,
            user,
            () => (tokenExpired ? null : "valid-token"),
            dbB!,
            mockAuthBlobDriver as any
        );

        // Calling getSettings on Device B while 401 MUST reject and NOT call reconcileGroups
        await expect(groupRepoB.getSettings()).rejects.toThrow(/Google Auth Failed/);

        // Reconnect Device B
        tokenExpired = false;
        const settingsB = await groupRepoB.getSettings();
        expect(settingsB.preferences.defaultCurrency).toBe("EUR");
        expect(settingsB.groupCache.some(g => g.id === group1.id)).toBe(true);
    });

    it("6. user_settings syncs even when active group is upgrade_required or corrupted", async () => {
        const { blobDriverA, providerA, blobDriverB, providerB } = createProviders(sharedCloudStorage);
        await providerA.initialize();
        await providerB.initialize();

        const coordA = new ReplicationCoordinator(dbA!, providerA);
        const coordB = new ReplicationCoordinator(dbB!, providerB);

        const groupRepoA = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbA!,
            blobDriverA,
            () => coordA.sync()
        );
        const groupRepoB = new GroupRepository(
            sharedCloudStorage,
            user,
            () => "token",
            dbB!,
            blobDriverB,
            () => coordB.sync()
        );

        // Initial settings created
        const group = await groupRepoA.create("Healthy Group");
        await coordA.sync(group.id);
        await coordB.sync(group.id);

        // Simulate corrupted active group spreadsheet
        const corruptedGroupId = "corrupted-sheet-id";
        vi.spyOn((providerA as any).tabularDriver, "checkHealth").mockResolvedValue({
            status: "UPGRADE_REQUIRED",
            canAutoMigrate: true,
            currentVersion: 1,
            latestVersion: 2
        });
        vi.spyOn((providerB as any).tabularDriver, "checkHealth").mockResolvedValue({
            status: "UPGRADE_REQUIRED",
            canAutoMigrate: true,
            currentVersion: 1,
            latestVersion: 2
        });

        // Device A updates currency to CHF
        const settingsA = await groupRepoA.getSettings();
        settingsA.preferences.defaultCurrency = "CHF";
        await groupRepoA.saveSettings(settingsA);

        // Device A syncs while group is in UPGRADE_REQUIRED state
        await coordA.sync(corruptedGroupId);

        // Device B syncs while group is in UPGRADE_REQUIRED state
        await coordB.sync(corruptedGroupId);

        // Verify: Device B successfully synced user_settings despite group schema failure!
        const settingsB = await groupRepoB.getSettings();
        expect(settingsB.preferences.defaultCurrency).toBe("CHF");
    });

    it("7. GoogleDriveBlobDriver duplicate file self-healing and write serialization", async () => {
        let fileCounter = 0;
        const fakeFiles = [
            {
                id: "file-old",
                name: "quozen-settings.json",
                modifiedTime: "2026-01-01T00:00:00.000Z",
                createdTime: "2026-01-01T00:00:00.000Z"
            },
            {
                id: "file-new",
                name: "quozen-settings.json",
                modifiedTime: "2026-06-01T00:00:00.000Z", // newer
                createdTime: "2026-06-01T00:00:00.000Z"
            }
        ];

        const deletedIds: string[] = [];

        const mockClient = {
            fetch: vi.fn(async (url: string, init?: any) => {
                const method = init?.method || "GET";
                if (url.includes("spaces=appDataFolder") && method === "GET") {
                    return {
                        ok: true,
                        json: async () => ({ files: [...fakeFiles] })
                    } as Response;
                }
                if (url.includes("/files/file-new?alt=media") && method === "GET") {
                    return {
                        ok: true,
                        json: async () => ({ version: 1, preferences: { defaultCurrency: "SEK" } })
                    } as Response;
                }
                if (method === "DELETE") {
                    const match = url.match(/\/files\/([^?]+)/);
                    if (match) deletedIds.push(match[1]);
                    return { ok: true, json: async () => ({}) } as Response;
                }
                if (method === "POST" || method === "PATCH") {
                    return { ok: true, json: async () => ({ id: "saved-id" }) } as Response;
                }
                return { ok: false, status: 404, text: async () => "Not Found" } as Response;
            })
        };

        const driver = new GoogleDriveBlobDriver({
            getAccessToken: () => "mock-token",
            httpClient: mockClient as any
        });

        // 1. Read blob with duplicate files in appDataFolder
        const readResult = await driver.readBlob("quozen-settings.json");
        expect(readResult?.preferences?.defaultCurrency).toBe("SEK");

        // Older file should be scheduled for deletion
        expect(deletedIds).toContain("file-old");

        // 2. Concurrent writeBlob serialization
        let activeWrites = 0;
        let maxConcurrentWrites = 0;

        mockClient.fetch = vi.fn(async (url: string, init?: any) => {
            if (init?.method === "PATCH" || init?.method === "POST") {
                activeWrites++;
                maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
                await new Promise(r => setTimeout(r, 20)); // Simulate async network latency
                activeWrites--;
                return { ok: true, json: async () => ({ id: "saved-id" }) } as Response;
            }
            if (url.includes("spaces=appDataFolder")) {
                return { ok: true, json: async () => ({ files: [{ id: "saved-id" }] }) } as Response;
            }
            return { ok: true, json: async () => ({}) } as Response;
        });

        // Launch 3 concurrent writes
        await Promise.all([
            driver.writeBlob("quozen-settings.json", { v: 1 }),
            driver.writeBlob("quozen-settings.json", { v: 2 }),
            driver.writeBlob("quozen-settings.json", { v: 3 })
        ]);

        // Max concurrency for writes on the same filename must be 1 (serialized!)
        expect(maxConcurrentWrites).toBe(1);
    });
});
