import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import {
    createQuozenDatabase,
    destroyQuozenDatabase,
    type QuozenDatabase
} from "../../src/db";
import {
    CompositeCloudSyncProvider,
    GoogleDriveBlobDriver,
    GoogleSheetsTabularDriver,
    ReplicationCoordinator
} from "../../src/sync";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { LedgerRepository } from "../../src/infrastructure/LedgerRepository";
import { LedgerService } from "../../src/finance/LedgerService";
import { User } from "../../src/domain/models";

describe("Phase 3 & 4: Local-First Repositories, ReplicationCoordinator & LWW Conflict Resolution", () => {
    let dbA: QuozenDatabase | null = null;
    let dbB: QuozenDatabase | null = null;
    let sharedCloudStorage: InMemoryAdapter;
    const userA: User = { id: "u1", username: "alice", name: "Alice", email: "alice@example.com" };
    const userB: User = { id: "u2", username: "bob", name: "Bob", email: "bob@example.com" };

    beforeEach(async () => {
        sharedCloudStorage = new InMemoryAdapter();
        dbA = await createQuozenDatabase({
            name: `test_client_a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });
        dbB = await createQuozenDatabase({
            name: `test_client_b_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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
    });

    it("LedgerRepository performs 0ms local CRUD against RxDB and soft-deletes via deletedAt tombstones", async () => {
        const groupId = "group-local-1";
        const repo = new LedgerRepository(sharedCloudStorage, groupId, dbA!);

        // Add members locally
        await repo.addMember({
            userId: "u1",
            email: "alice@example.com",
            name: "Alice",
            role: "owner",
            joinedAt: new Date("2026-01-01T00:00:00Z")
        });
        await repo.addMember({
            userId: "u2",
            email: "bob@example.com",
            name: "Bob",
            role: "member",
            joinedAt: new Date("2026-01-01T00:00:00Z")
        });

        const service = new LedgerService(repo, userA);
        const created = await service.addExpense({
            description: "Coffee",
            amount: 10,
            category: "Food",
            date: new Date("2026-02-01T10:00:00Z"),
            paidByUserId: "u1"
        });

        const activeExpenses = await repo.getExpenses();
        expect(activeExpenses).toHaveLength(1);
        expect(activeExpenses[0].id).toBe(created.id);
        expect(activeExpenses[0].splits).toHaveLength(2);

        // Delete expense -> creates soft-delete tombstone in RxDB
        await repo.deleteExpense(created.id);

        const afterDelete = await repo.getExpenses();
        expect(afterDelete).toHaveLength(0);

        // Verify tombstone still exists in RxDB with deletedAt populated for sync propagation
        const rawDoc = await dbA!.expenses.findOne(created.id).exec();
        expect(rawDoc).not.toBeNull();
        expect(rawDoc?.deletedAt).toBeTruthy();
    });

    it("ReplicationCoordinator syncs offline local mutations to remote Google Sheets tabular storage on reconnect", async () => {
        // 1. Setup a group spreadsheet in sharedCloudStorage
        const groupId = await sharedCloudStorage.createSpreadsheet(
            "Quozen - Trip",
            ["Expenses", "Settlements", "Members"],
            { quozen_type: "group", version: "1.0" }
        );
        await sharedCloudStorage.batchUpdateValues(groupId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt"]] }
        ]);

        // 2. Client A operates completely offline (local-only in dbA)
        const repoA = new LedgerRepository(undefined, groupId, dbA!);
        await repoA.addMember({
            userId: "u1",
            email: "alice@example.com",
            name: "Alice",
            role: "owner",
            joinedAt: new Date("2026-01-01T00:00:00Z")
        });
        await repoA.addExpense({
            id: "offline-exp-1",
            description: "Offline Taxi",
            amount: 40,
            category: "Transport",
            date: new Date("2026-03-01T12:00:00Z"),
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 40 }],
            createdAt: new Date("2026-03-01T12:00:00Z"),
            updatedAt: new Date("2026-03-01T12:00:00Z")
        });

        // Verify remote sheet is still empty before sync
        const beforeSyncRows = await sharedCloudStorage.batchGetValues(groupId, ["Expenses!A2:Z"]);
        expect(beforeSyncRows[0]?.values || []).toHaveLength(0);

        // 3. Reconnect and run ReplicationCoordinator
        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        await providerA.initialize();

        const coordinatorA = new ReplicationCoordinator(dbA!, providerA);
        await coordinatorA.sync(groupId);

        // 4. Verify offline expense was pushed to the remote spreadsheet
        const afterSyncRows = await sharedCloudStorage.batchGetValues(groupId, ["Expenses!A2:Z"]);
        expect(afterSyncRows[0]?.values).toHaveLength(1);
        expect(afterSyncRows[0]?.values[0][0]).toBe("offline-exp-1");
        expect(afterSyncRows[0]?.values[0][2]).toBe("Offline Taxi");
    });

    it("resolves concurrent multi-client edits deterministically via Last-Write-Wins (LWW) using updatedAt", async () => {
        const groupId = await sharedCloudStorage.createSpreadsheet(
            "Quozen - Shared Group",
            ["Expenses", "Settlements", "Members"],
            { quozen_type: "group", version: "1.0" }
        );
        await sharedCloudStorage.batchUpdateValues(groupId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt"]] }
        ]);

        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        const providerB = new CompositeCloudSyncProvider({
            id: "gdrive-b",
            name: "Google Drive B",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        await providerA.initialize();
        await providerB.initialize();

        const coordinatorA = new ReplicationCoordinator(dbA!, providerA);
        const coordinatorB = new ReplicationCoordinator(dbB!, providerB);

        const repoA = new LedgerRepository(undefined, groupId, dbA!);
        const repoB = new LedgerRepository(undefined, groupId, dbB!);

        // Client A edits exp-shared at T1 (older)
        await repoA.addExpense({
            id: "exp-shared",
            description: "Dinner (Alice Edit)",
            amount: 75,
            category: "Food",
            date: new Date("2026-04-01T20:00:00Z"),
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 75 }],
            createdAt: new Date("2026-04-01T20:00:00Z"),
            updatedAt: new Date("2026-04-01T20:05:00Z") // T1: 20:05
        });

        // Client B edits exp-shared at T2 (newer: 20:10) while offline
        await repoB.addExpense({
            id: "exp-shared",
            description: "Dinner (Bob Newer Edit)",
            amount: 90,
            category: "Food",
            date: new Date("2026-04-01T20:00:00Z"),
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 90 }],
            createdAt: new Date("2026-04-01T20:00:00Z"),
            updatedAt: new Date("2026-04-01T20:10:00Z") // T2: 20:10 (Newer!)
        });

        // Client A syncs first, then Client B syncs, then Client A syncs again
        await coordinatorA.sync(groupId);
        await coordinatorB.sync(groupId);
        await coordinatorA.sync(groupId);

        const expensesA = await repoA.getExpenses();
        const expensesB = await repoB.getExpenses();

        expect(expensesA).toHaveLength(1);
        expect(expensesB).toHaveLength(1);
        expect(expensesA[0].amount).toBe(90);
        expect(expensesA[0].description).toBe("Dinner (Bob Newer Edit)");
        expect(expensesB[0].amount).toBe(90);
        expect(expensesB[0].description).toBe("Dinner (Bob Newer Edit)");
    });

    it("propagates soft-delete tombstones across clients when a newer deletion occurs", async () => {
        const groupId = await sharedCloudStorage.createSpreadsheet(
            "Quozen - Delete Sync",
            ["Expenses", "Settlements", "Members"],
            { quozen_type: "group", version: "1.0" }
        );
        await sharedCloudStorage.batchUpdateValues(groupId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt"]] }
        ]);

        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        const providerB = new CompositeCloudSyncProvider({
            id: "gdrive-b",
            name: "Google Drive B",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        await providerA.initialize();
        await providerB.initialize();

        const coordinatorA = new ReplicationCoordinator(dbA!, providerA);
        const coordinatorB = new ReplicationCoordinator(dbB!, providerB);

        const repoA = new LedgerRepository(undefined, groupId, dbA!);
        const repoB = new LedgerRepository(undefined, groupId, dbB!);

        // 1. Client A creates an expense and syncs
        await repoA.addExpense({
            id: "exp-to-delete",
            description: "Mistake Expense",
            amount: 50,
            category: "Misc",
            date: new Date("2026-05-01T10:00:00Z"),
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 50 }],
            createdAt: new Date("2026-05-01T10:00:00Z"),
            updatedAt: new Date("2026-05-01T10:00:00Z")
        });
        await coordinatorA.sync(groupId);

        // 2. Client B pulls the expense
        await coordinatorB.sync(groupId);
        expect(await repoB.getExpenses()).toHaveLength(1);

        // 3. Client A deletes the expense and syncs
        await repoA.deleteExpense("exp-to-delete");
        await coordinatorA.sync(groupId);

        // 4. Client B syncs and sees the expense is removed
        await coordinatorB.sync(groupId);
        expect(await repoB.getExpenses()).toHaveLength(0);
    });

    it("consolidates multi-device offline/online edits across Expenses, Settlements, and Members when switching devices", async () => {
        const groupId = await sharedCloudStorage.createSpreadsheet(
            "Quozen - Multi-Device Consolidation",
            ["Expenses", "Settlements", "Members"],
            { quozen_type: "group", version: "1.0" }
        );
        await sharedCloudStorage.batchUpdateValues(groupId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes", "updatedAt"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt", "updatedAt"]] }
        ]);

        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        const providerB = new CompositeCloudSyncProvider({
            id: "gdrive-b",
            name: "Google Drive B",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        await providerA.initialize();
        await providerB.initialize();

        const repoA = new LedgerRepository(undefined, groupId, dbA!);
        const repoB = new LedgerRepository(undefined, groupId, dbB!);

        // Step 1: Device A seeds initial members and a shared expense online, then syncs
        await repoA.addMember({
            userId: "u1",
            email: "alice@example.com",
            name: "Alice",
            role: "owner",
            joinedAt: new Date("2026-06-01T09:00:00Z")
        });
        await repoA.addMember({
            userId: "u2",
            email: "bob@example.com",
            name: "Bob",
            role: "member",
            joinedAt: new Date("2026-06-01T09:00:00Z")
        });
        await repoA.addExpense({
            id: "exp-hotel",
            description: "Hotel Booking (Initial)",
            amount: 200,
            category: "Lodging",
            date: new Date("2026-06-01T10:00:00Z"),
            paidByUserId: "u1",
            splits: [
                { userId: "u1", amount: 100 },
                { userId: "u2", amount: 100 }
            ],
            createdAt: new Date("2026-06-01T10:00:00Z"),
            updatedAt: new Date("2026-06-01T10:00:00Z")
        });

        const coordinatorA1 = new ReplicationCoordinator(dbA!, providerA);
        await coordinatorA1.sync(groupId);

        // Step 2: User on Device A loses internet connection, adds an offline expense & settlement, and closes browser
        await repoA.addExpense({
            id: "exp-device-a-offline",
            description: "Airport Coffee (Offline on A)",
            amount: 12,
            category: "Food",
            date: new Date("2026-06-01T11:00:00Z"),
            paidByUserId: "u1",
            splits: [
                { userId: "u1", amount: 6 },
                { userId: "u2", amount: 6 }
            ],
            createdAt: new Date("2026-06-01T11:00:00Z"),
            updatedAt: new Date("2026-06-01T11:00:00Z")
        });
        await repoA.addSettlement({
            id: "settle-a-offline",
            date: new Date("2026-06-01T11:05:00Z"),
            fromUserId: "u2",
            toUserId: "u1",
            amount: 50,
            method: "cash",
            notes: "Partial cash on A",
            createdAt: new Date("2026-06-01T11:05:00Z"),
            updatedAt: new Date("2026-06-01T11:05:00Z")
        });

        // Step 3: User switches to Device B (online), pulls latest cloud state, edits shared expense, adds a new expense
        const coordinatorB = new ReplicationCoordinator(dbB!, providerB);
        await coordinatorB.sync(groupId);

        // Device B updates "exp-hotel" with a newer timestamp (12:00Z > 10:00Z)
        await dbB!.expenses.upsert({
            id: "exp-hotel",
            groupId,
            description: "Hotel Booking (Upgraded Suite on B)",
            amount: 260,
            category: "Lodging",
            date: "2026-06-01T10:00:00.000Z",
            paidByUserId: "u1",
            splits: [
                { userId: "u1", amount: 130 },
                { userId: "u2", amount: 130 }
            ],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T12:00:00.000Z",
            deletedAt: null
        });

        // Device B also adds a new expense online
        await repoB.addExpense({
            id: "exp-device-b-online",
            description: "Museum Tickets (On B)",
            amount: 40,
            category: "Entertainment",
            date: new Date("2026-06-01T12:30:00Z"),
            paidByUserId: "u2",
            splits: [
                { userId: "u1", amount: 20 },
                { userId: "u2", amount: 20 }
            ],
            createdAt: new Date("2026-06-01T12:30:00Z"),
            updatedAt: new Date("2026-06-01T12:30:00Z")
        });
        await coordinatorB.sync(groupId);

        // Step 4: Device A comes back online (new ReplicationCoordinator instance simulating browser reopen)
        const coordinatorA2 = new ReplicationCoordinator(dbA!, providerA);
        await coordinatorA2.sync(groupId);

        // Device B syncs again to receive Device A's offline entries
        await coordinatorB.sync(groupId);

        const finalExpensesA = await repoA.getExpenses();
        const finalExpensesB = await repoB.getExpenses();
        const finalSettlementsA = await repoA.getSettlements();
        const finalSettlementsB = await repoB.getSettlements();

        expect(finalExpensesA).toHaveLength(3);
        expect(finalExpensesB).toHaveLength(3);

        const hotelA = finalExpensesA.find(e => e.id === "exp-hotel");
        const hotelB = finalExpensesB.find(e => e.id === "exp-hotel");
        expect(hotelA?.amount).toBe(260);
        expect(hotelA?.description).toBe("Hotel Booking (Upgraded Suite on B)");
        expect(hotelB?.amount).toBe(260);

        expect(finalExpensesA.some(e => e.id === "exp-device-a-offline")).toBe(true);
        expect(finalExpensesB.some(e => e.id === "exp-device-a-offline")).toBe(true);
        expect(finalExpensesA.some(e => e.id === "exp-device-b-online")).toBe(true);
        expect(finalExpensesB.some(e => e.id === "exp-device-b-online")).toBe(true);

        expect(finalSettlementsA).toHaveLength(1);
        expect(finalSettlementsB).toHaveLength(1);
        expect(finalSettlementsB[0].id).toBe("settle-a-offline");
    });

    it("does not resurrect remotely deleted records after Device A reloads with a new ReplicationCoordinator instance", async () => {
        const groupId = await sharedCloudStorage.createSpreadsheet(
            "Quozen - No Resurrection After Reload",
            ["Expenses", "Settlements", "Members"],
            { quozen_type: "group", version: "1.0" }
        );
        await sharedCloudStorage.batchUpdateValues(groupId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes", "updatedAt"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt", "updatedAt"]] }
        ]);

        const providerA = new CompositeCloudSyncProvider({
            id: "gdrive-a",
            name: "Google Drive A",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        const providerB = new CompositeCloudSyncProvider({
            id: "gdrive-b",
            name: "Google Drive B",
            blobDriver: new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: sharedCloudStorage }),
            activeGroupId: groupId
        });
        await providerA.initialize();
        await providerB.initialize();

        const repoA = new LedgerRepository(undefined, groupId, dbA!);
        const repoB = new LedgerRepository(undefined, groupId, dbB!);

        // 1. Device A adds an expense and syncs
        await repoA.addExpense({
            id: "exp-reload-delete",
            description: "To Be Deleted On B",
            amount: 35,
            category: "Food",
            date: new Date("2026-07-01T10:00:00Z"),
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 35 }],
            createdAt: new Date("2026-07-01T10:00:00Z"),
            updatedAt: new Date("2026-07-01T10:00:00Z")
        });
        const coordinatorA1 = new ReplicationCoordinator(dbA!, providerA);
        await coordinatorA1.sync(groupId);

        // 2. Device B pulls the expense, deletes it, and syncs deletion to Google Sheet
        const coordinatorB = new ReplicationCoordinator(dbB!, providerB);
        await coordinatorB.sync(groupId);
        expect(await repoB.getExpenses()).toHaveLength(1);

        await repoB.deleteExpense("exp-reload-delete");
        await coordinatorB.sync(groupId);
        expect(await repoB.getExpenses()).toHaveLength(0);

        // 3. Device A reloads browser -> brand new ReplicationCoordinator instance over dbA
        const coordinatorA2 = new ReplicationCoordinator(dbA!, providerA);
        await coordinatorA2.sync(groupId);

        // Expense must be soft-deleted on Device A and NOT re-pushed to remote storage
        expect(await repoA.getExpenses()).toHaveLength(0);
        const remoteRows = await sharedCloudStorage.batchGetValues(groupId, ["Expenses!A2:Z"]);
        expect(remoteRows[0]?.values || []).toHaveLength(0);
    });
});

