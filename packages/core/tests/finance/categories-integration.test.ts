import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LedgerService } from "../../src/finance/LedgerService";
import { LedgerRepository } from "../../src/infrastructure/LedgerRepository";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { createQuozenDatabase, destroyQuozenDatabase, QuozenDatabase } from "../../src/db";
import { User, ExpenseCategory } from "../../src/domain/models";
import { DEFAULT_CATEGORIES } from "../../src/domain/categories";
import { InvalidCategoryError } from "../../src/errors";
import { CompositeCloudSyncProvider } from "../../src/sync/CompositeCloudSyncProvider";
import { TabularStorageDriver, TabularRow } from "../../src/sync/types";

describe("WP4: Category Persistence, Validation, Group Creation & Cloud Sync", () => {
    let storage: InMemoryAdapter;
    let db: QuozenDatabase;
    let user: User;
    let groupId: string;
    let repo: LedgerRepository;
    let service: LedgerService;

    beforeEach(async () => {
        storage = new InMemoryAdapter();
        db = await createQuozenDatabase({
            name: `test_wp4_${Date.now()}_${Math.random().toString(36).slice(2)}`
        });
        user = { id: "user-1", name: "Alice", email: "alice@example.com" };

        const groupRepo = new GroupRepository(storage, user, undefined, db);
        const group = await groupRepo.create("Vacation Group", [
            { username: "Bob", email: "bob@example.com" }
        ]);
        groupId = group.id;

        repo = new LedgerRepository(storage, groupId, db);
        service = new LedgerService(repo, user, undefined, groupId);
    });

    afterEach(async () => {
        if (db) {
            await destroyQuozenDatabase(db);
        }
    });

    it("seeds Categories tab and local RxDB categories collection when creating a group", async () => {
        const categories = await repo.getCategories();
        expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
        expect(categories.map(c => c.id)).toEqual(
            expect.arrayContaining(["food_dining", "transportation", "accommodation", "entertainment", "shopping", "other"])
        );

        // Verify spreadsheet values in memory adapter
        const res = await storage.batchGetValues(groupId, ["Categories!A1:E7"]);
        const rows = res[0]?.values || [];
        expect(rows.length).toBeGreaterThanOrEqual(7); // 1 header + 6 categories
        expect(rows[0]).toEqual(["id", "name", "icon", "description", "updatedAt"]);
    });

    it("adds expense with valid category ID", async () => {
        const expense = await service.addExpense({
            description: "Dinner at Bistro",
            amount: 60,
            category: "food_dining",
            date: new Date().toISOString(),
            paidByUserId: user.id
        });

        expect(expense.category).toBe("food_dining");
        const fetched = await repo.getExpenses();
        expect(fetched[0].category).toBe("food_dining");
    });

    it("adds expense with case-insensitive category name and resolves to ID", async () => {
        const expense = await service.addExpense({
            description: "Train tickets",
            amount: 40,
            category: "Transportation", // Name instead of ID
            date: new Date().toISOString(),
            paidByUserId: user.id
        });

        expect(expense.category).toBe("transportation");
    });

    it("defaults omitted category to 'other'", async () => {
        const expense = await service.addExpense({
            description: "Random tip",
            amount: 5,
            date: new Date().toISOString(),
            paidByUserId: user.id
        });

        expect(expense.category).toBe("other");
    });

    it("throws InvalidCategoryError when adding expense with unknown category", async () => {
        await expect(
            service.addExpense({
                description: "Space rocket",
                amount: 1000,
                category: "interstellar_travel_xyz",
                date: new Date().toISOString(),
                paidByUserId: user.id
            })
        ).rejects.toThrow(InvalidCategoryError);
    });

    it("validates category on expense update", async () => {
        const expense = await service.addExpense({
            description: "Groceries",
            amount: 50,
            category: "food_dining",
            date: new Date().toISOString(),
            paidByUserId: user.id
        });

        // Valid update
        await service.updateExpense(expense.id, {
            category: "shopping"
        });
        let expenses = await repo.getExpenses();
        expect(expenses.find(e => e.id === expense.id)?.category).toBe("shopping");

        // Invalid update throws InvalidCategoryError
        await expect(
            service.updateExpense(expense.id, {
                category: "fake_category_xyz"
            })
        ).rejects.toThrow(InvalidCategoryError);
    });

    it("provides categories via getLedger()", async () => {
        const ledger = await service.getLedger();
        expect(ledger.categories).toBeDefined();
        expect(ledger.categories.length).toBe(DEFAULT_CATEGORIES.length);
        expect(ledger.getCategory("food_dining")?.name).toBe("Food & Dining");
    });

    it("CompositeCloudSyncProvider handles categories serialization and legacy sheets without Categories tab", async () => {
        const tabularDriver: TabularStorageDriver = {
            readTable: async (gId: string, tabName: string): Promise<TabularRow[]> => {
                if (tabName === "Categories") {
                    return [
                        {
                            id: "food_dining",
                            headers: ["id", "name", "icon", "description", "updatedAt"],
                            values: ["food_dining", "Food & Dining", "utensils", "Groceries & dining", "2026-01-01T00:00:00.000Z"]
                        }
                    ];
                }
                return [];
            },
            writeTable: async () => {}
        };

        const provider = new CompositeCloudSyncProvider({
            tabularDriver
        });
        await provider.initialize();
        provider.setActiveGroupId("group-test");

        const deltas = await provider.pull("group-test");
        const categoryDelta = deltas.find(d => d.collection === "categories");
        expect(categoryDelta).toBeDefined();
        expect(categoryDelta?.documents).toHaveLength(1);
        expect(categoryDelta?.documents[0].categoryId).toBe("food_dining");

        // Test legacy sheet where readTable for Categories throws missing tab error
        const legacyDriver: TabularStorageDriver = {
            readTable: async (gId: string, tabName: string) => {
                if (tabName === "Categories") {
                    throw new Error("Sheet not found: Categories");
                }
                return [];
            },
            writeTable: async () => {}
        };

        const legacyProvider = new CompositeCloudSyncProvider({
            tabularDriver: legacyDriver
        });
        await legacyProvider.initialize();
        legacyProvider.setActiveGroupId("legacy-group");

        // Should not throw, gracefully skips missing Categories tab
        const legacyDeltas = await legacyProvider.pull("legacy-group");
        expect(legacyDeltas.find(d => d.collection === "categories")).toBeUndefined();
    });

    it("hydrates from legacy v1 spreadsheet without Categories tab without throwing and seeds DEFAULT_CATEGORIES", async () => {
        // Create an unmigrated legacy sheet in storage with NO Categories tab
        const legacyStorage = new InMemoryAdapter();
        // Setup initial tabs: Members, Expenses, Settlements (no Categories)
        const legacyGroupId = await legacyStorage.createSpreadsheet("Legacy Group", ["Members", "Expenses", "Settlements"]);
        await legacyStorage.appendValues(legacyGroupId, "Members!A1:E", [
            ["userId", "email", "name", "role", "updatedAt"],
            ["user-1", "alice@example.com", "Alice", "owner", new Date().toISOString()]
        ]);
        await legacyStorage.appendValues(legacyGroupId, "Expenses!A1:I", [
            ["id", "date", "description", "amount", "paidByUserId", "category", "splits", "createdAt", "updatedAt"],
            ["exp-1", "2026-01-01", "Dinner", "50", "user-1", "Food", JSON.stringify([{ userId: "user-1", amount: 50 }]), new Date().toISOString(), new Date().toISOString()]
        ]);
        await legacyStorage.appendValues(legacyGroupId, "Settlements!A1:G", [
            ["id", "date", "fromUserId", "toUserId", "amount", "method", "updatedAt"]
        ]);

        // Mock batchGetValues to throw 400 Bad Request on Categories!A1:Z
        const originalBatchGet = legacyStorage.batchGetValues.bind(legacyStorage);
        legacyStorage.batchGetValues = async (id: string, ranges: string[]) => {
            if (ranges.some(r => r.includes("Categories"))) {
                throw new Error("Google API Error 400: Unable to parse range: Categories!A1:Z");
            }
            return originalBatchGet(id, ranges);
        };

        const legacyRepo = new LedgerRepository(legacyStorage, legacyGroupId, db);
        const expenses = await legacyRepo.getExpenses();
        expect(expenses).toHaveLength(1);
        expect(expenses[0].id).toBe("exp-1");

        const categories = await legacyRepo.getCategories();
        expect(categories.length).toBeGreaterThanOrEqual(DEFAULT_CATEGORIES.length);
        expect(categories.find(c => c.id === "food_dining")).toBeDefined();
    });

    it("CompositeCloudSyncProvider detects UPGRADE_REQUIRED via checkHealth and suspends sync", async () => {
        const upgradeDriver: TabularStorageDriver = {
            readTable: async () => [],
            writeTable: async () => {},
            checkHealth: async () => ({
                spreadsheetId: "legacy-v1-sheet",
                currentVersion: 1,
                latestVersion: 2,
                status: "UPGRADE_REQUIRED",
                missingTabs: ["Categories"],
                missingColumns: {},
                canAutoMigrate: true,
                lastModifiedTime: new Date().toISOString()
            } as any)
        };

        const provider = new CompositeCloudSyncProvider({
            tabularDriver: upgradeDriver
        });
        await provider.initialize();
        provider.setActiveGroupId("legacy-v1-sheet");

        const deltas = await provider.pull("legacy-v1-sheet");
        expect(deltas).toEqual([]);
        expect(provider.getStatus()).toBe("upgrade_required");

        // Push should also be skipped when in upgrade_required status
        await provider.push({
            collection: "categories",
            groupId: "legacy-v1-sheet",
            documents: [{ id: "cat-1", name: "Custom" }]
        });
        // Status remains upgrade_required
        expect(provider.getStatus()).toBe("upgrade_required");
    });
});
