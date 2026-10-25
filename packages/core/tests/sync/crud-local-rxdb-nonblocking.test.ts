import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import {
    createQuozenDatabase,
    destroyQuozenDatabase,
    type QuozenDatabase
} from "../../src/db";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { LedgerRepository } from "../../src/infrastructure/LedgerRepository";
import { LedgerService } from "../../src/finance/LedgerService";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { ReplicationCoordinator } from "../../src/sync";
import { User, Member } from "../../src/domain/models";
import { DEFAULT_CATEGORIES } from "../../src/domain/categories";

describe("CRUD Operations Local RxDB Non-Blocking Behavior", () => {
    let db: QuozenDatabase;
    let storage: InMemoryAdapter;
    const user: User = { id: "u-owner", username: "owner", name: "Owner", email: "owner@example.com" };

    beforeEach(async () => {
        storage = new InMemoryAdapter();
        db = await createQuozenDatabase({
            name: `test_crud_nonblocking_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });
    });

    afterEach(async () => {
        await destroyQuozenDatabase(db);
        vi.restoreAllMocks();
    });

    it("hydrates lazily on first read, but never calls storage on subsequent CRUD writes", async () => {
        const groupId = await storage.createSpreadsheet(
            "Quozen - Test Group",
            ["Expenses", "Settlements", "Members", "Categories"],
            { quozen_type: "group", version: "1.0" }
        );

        // Pre-populate sheet with 1 member
        await storage.appendValues(groupId, "Members!A1", [
            ["User ID", "Email", "Name", "Role", "Joined At"],
            ["u-owner", "owner@example.com", "Owner", "owner", new Date().toISOString()]
        ]);

        const repo = new LedgerRepository(storage, groupId, db);
        const service = new LedgerService(repo, user);

        const batchGetSpy = vi.spyOn(storage, "batchGetValues");
        const appendSpy = vi.spyOn(storage, "appendValues");
        const updateSpy = vi.spyOn(storage, "updateValues");

        // 1. First-time access: lazy hydration is triggered on first read
        const members = await repo.getMembers();
        expect(members).toHaveLength(1);
        expect(batchGetSpy).toHaveBeenCalled();
        expect(ReplicationCoordinator.isGroupHydrated(db.name, groupId)).toBe(true);

        // Reset spies to monitor subsequent CRUD operations
        batchGetSpy.mockClear();
        appendSpy.mockClear();
        updateSpy.mockClear();

        // 2. Read categories should not hit storage when db is active
        const categories = await repo.getCategories();
        expect(categories.length).toBeGreaterThan(0);
        expect(batchGetSpy).not.toHaveBeenCalled();

        // 3. Add expense should write purely to RxDB without calling storage.batchGetValues or storage.appendValues
        const expense = await service.addExpense({
            description: "Coffee",
            amount: 15,
            category: "food_dining",
            date: new Date(),
            paidByUserId: "u-owner"
        });
        expect(expense.id).toBeDefined();
        expect(batchGetSpy).not.toHaveBeenCalled();
        expect(appendSpy).not.toHaveBeenCalled();

        // 4. Update expense should write purely to RxDB without calling storage.batchGetValues or storage.updateValues
        await service.updateExpense(expense.id, {
            description: "Coffee & Pastry"
        });
        expect(batchGetSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();

        // 5. Delete expense should write soft-delete tombstone to RxDB without calling storage
        await service.deleteExpense(expense.id);
        expect(batchGetSpy).not.toHaveBeenCalled();

        // 6. Add settlement should write purely to RxDB without calling storage
        await repo.addMember({
            userId: "u-member",
            email: "member@example.com",
            name: "Member",
            role: "member",
            joinedAt: new Date()
        });
        batchGetSpy.mockClear();

        const settlement = await service.addSettlement({
            fromUserId: "u-member",
            toUserId: "u-owner",
            amount: 10,
            method: "cash"
        });
        expect(settlement.id).toBeDefined();
        expect(batchGetSpy).not.toHaveBeenCalled();
        expect(appendSpy).not.toHaveBeenCalled();

        // 7. Update settlement should write purely to RxDB without calling storage
        await service.updateSettlement(settlement.id, {
            amount: 12
        });
        expect(batchGetSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();

        // 8. Delete settlement should write soft-delete tombstone to RxDB without calling storage
        await service.deleteSettlement(settlement.id);
        expect(batchGetSpy).not.toHaveBeenCalled();
    });

    it("getCategories does not fall through to storage.batchGetValues when categories collection is empty in RxDB", async () => {
        const groupId = "test-empty-cat-group";
        const repo = new LedgerRepository(storage, groupId, db);

        // Pre-mark group as hydrated so it doesn't trigger first-read hydration
        ReplicationCoordinator.markGroupHydrated(db.name, groupId);

        const batchGetSpy = vi.spyOn(storage, "batchGetValues");
        const cats = await repo.getCategories();

        // Should return DEFAULT_CATEGORIES directly from local memory/schema without hitting remote storage
        expect(cats.map(c => c.id).sort()).toEqual(DEFAULT_CATEGORIES.map(c => c.id).sort());
        expect(batchGetSpy).not.toHaveBeenCalled();
    });

    it("LedgerRepository provides getExpenseById and getSettlementById for direct O(1) lookups", async () => {
        const groupId = "test-group-id";
        const repo = new LedgerRepository(storage, groupId, db);

        // Seed 1 expense and 1 settlement directly
        await db.expenses.insert({
            id: "exp-1",
            groupId,
            description: "Lunch",
            amount: 25,
            category: "food_dining",
            date: new Date().toISOString(),
            paidByUserId: "u-owner",
            splits: [{ userId: "u-owner", amount: 25 }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null
        });

        await db.settlements.insert({
            id: "set-1",
            groupId,
            date: new Date().toISOString(),
            fromUserId: "u-member",
            toUserId: "u-owner",
            amount: 25,
            method: "cash",
            notes: "Lunch payback",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null
        });

        const exp = await repo.getExpenseById("exp-1");
        expect(exp).not.toBeNull();
        expect(exp?.id).toBe("exp-1");
        expect(exp?.description).toBe("Lunch");

        const missingExp = await repo.getExpenseById("non-existent");
        expect(missingExp).toBeNull();

        const set = await repo.getSettlementById("set-1");
        expect(set).not.toBeNull();
        expect(set?.id).toBe("set-1");
        expect(set?.amount).toBe(25);

        const missingSet = await repo.getSettlementById("non-existent");
        expect(missingSet).toBeNull();
    });

    it("GroupRepository.updateGroup does not call storage.updateFile when group title has not changed", async () => {
        const groupRepo = new GroupRepository(
            storage,
            user,
            undefined,
            db
        );

        // Create group
        const group = await groupRepo.create("Original Title");
        const updateFileSpy = vi.spyOn(storage, "updateFile");

        // Update group members without changing title
        await groupRepo.updateGroup(group.id, "Original Title", [
            { username: "offline_friend" }
        ]);

        // storage.updateFile should NOT be called since title was unchanged
        expect(updateFileSpy).not.toHaveBeenCalled();
    });

    it("GroupRepository.getGroupAccountId caches account lookup to prevent repeated getSettings calls", async () => {
        const groupRepo = new GroupRepository(
            storage,
            user,
            undefined,
            db
        );
        const group = await groupRepo.create("Cache Test Group");

        const getSettingsSpy = vi.spyOn(groupRepo, "getSettings");
        
        // First lookup
        const acc1 = await groupRepo.getGroupAccountId(group.id);
        expect(getSettingsSpy).toHaveBeenCalledTimes(1);

        // Second lookup should hit accountIdCache and not call getSettings again
        const acc2 = await groupRepo.getGroupAccountId(group.id);
        expect(acc1).toBe(acc2);
        expect(getSettingsSpy).toHaveBeenCalledTimes(1);
    });
});
