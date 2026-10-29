import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { User } from "../../src/domain/models";
import { GroupFileUnavailableError } from "../../src/errors";
import { createQuozenDatabase, destroyQuozenDatabase, type QuozenDatabase } from "../../src/db/database";
import { expenseToDoc, memberToDoc } from "../../src/db/schemas";
import { ReplicationCoordinator } from "../../src/sync/ReplicationCoordinator";
import { CompositeCloudSyncProvider } from "../../src/sync/CompositeCloudSyncProvider";

describe("GroupFileUnavailable Detection, Purging & Sync Lifecycle", () => {
    let adapter: InMemoryAdapter;
    let repo: GroupRepository;
    let db: QuozenDatabase;
    const user: User = {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
        username: "test"
    };

    beforeEach(async () => {
        adapter = new InMemoryAdapter();
        db = await createQuozenDatabase({ name: `test_unavailable_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` });
        repo = new GroupRepository(adapter as any, user, () => "mock-token", db);
    });

    afterEach(async () => {
        if (db) {
            await destroyQuozenDatabase(db);
        }
    });

    it("purgeUnavailableGroup removes group from groupCache, archivedGroupCache, resets activeGroupId, and deletes all cached RxDB documents", async () => {
        const group1 = await repo.create("Group 1");
        const group2 = await repo.create("Group 2");

        // Seed RxDB collections for group1
        await db.expenses.insert(expenseToDoc({
            id: "exp-1",
            description: "Dinner",
            amount: 50,
            date: "2026-10-28",
            paidByUserId: user.id,
            splits: [{ userId: user.id, amount: 50 }],
            category: "Food"
        }, group1.id));

        expect(await db.expenses.find({ selector: { groupId: group1.id } }).exec()).toHaveLength(1);
        expect(await db.members.find({ selector: { groupId: group1.id } }).exec()).toHaveLength(1);

        ReplicationCoordinator.markGroupHydrated(db.name, group1.id);
        expect(ReplicationCoordinator.isGroupHydrated(db.name, group1.id)).toBe(true);

        // Purge group1
        await repo.purgeUnavailableGroup(group1.id, "Group 1", "deleted");

        // Verify settings are updated
        const settings = await repo.getSettings();
        expect(settings.groupCache.some(g => g.id === group1.id)).toBe(false);
        expect(settings.archivedGroupCache?.some(g => g.id === group1.id)).toBe(false);
        expect(settings.activeGroupId).toBe(group2.id);

        // Verify RxDB collections are purged
        const remainingExpenses = await db.expenses.find({ selector: { groupId: group1.id } }).exec();
        const remainingMembers = await db.members.find({ selector: { groupId: group1.id } }).exec();
        expect(remainingExpenses).toHaveLength(0);
        expect(remainingMembers).toHaveLength(0);

        // Verify hydration tracking is cleared
        expect(ReplicationCoordinator.isGroupHydrated(db.name, group1.id)).toBe(false);
    });

    it("updateGroup throws GroupFileUnavailableError and purges all caches when spreadsheet was trashed", async () => {
        const group = await repo.create("Edit Me");
        await repo.create("Other Group");

        // Seed an expense in RxDB
        await db.expenses.insert(expenseToDoc({
            id: "exp-to-purge",
            description: "Lunch",
            amount: 20,
            date: "2026-10-28",
            paidByUserId: user.id,
            splits: [{ userId: user.id, amount: 20 }],
            category: "Food"
        }, group.id));

        // Trash file in Drive adapter
        adapter.trashFile(group.id);

        await expect(repo.updateGroup(group.id, "Renamed Group", [])).rejects.toThrow(GroupFileUnavailableError);

        const settings = await repo.getSettings();
        expect(settings.groupCache.some(g => g.id === group.id)).toBe(false);
        const expenses = await db.expenses.find({ selector: { groupId: group.id } }).exec();
        expect(expenses).toHaveLength(0);
    });

    it("CompositeCloudSyncProvider.pull throws GroupFileUnavailableError when active group returns 404 or trashed error", async () => {
        const mockTabularDriver: any = {
            id: "mock-tabular",
            name: "Mock Tabular",
            readTable: async () => {
                const err: any = new Error("Google API Error 404: File not found: mock-404-id");
                err.status = 404;
                throw err;
            },
            checkHealth: async () => {
                const err: any = new Error("File not found");
                err.status = 404;
                throw err;
            }
        };

        const provider = new CompositeCloudSyncProvider({
            tabularDriver: mockTabularDriver
        });
        await provider.initialize();

        await expect(provider.pull("mock-404-id")).rejects.toThrow(GroupFileUnavailableError);
    });
});
