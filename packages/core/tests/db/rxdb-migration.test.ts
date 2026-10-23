import { describe, it, expect, afterEach } from "vitest";
import { createRxDatabase, addRxPlugin } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import {
    createQuozenDatabase,
    destroyQuozenDatabase,
    categorySchema,
    categoryToDoc,
    docToCategory,
    CategoryIntegrityReconciler,
    type QuozenDatabase
} from "../../src/db";
import { DEFAULT_CATEGORIES, ExpenseCategory } from "../../src/domain/categories";

addRxPlugin(RxDBMigrationSchemaPlugin);

describe("WP3: RxDB Schema, Categories Collection, v0->v1 Migration & Self-Healing", () => {
    let db: QuozenDatabase | null = null;

    afterEach(async () => {
        if (db) {
            await destroyQuozenDatabase(db);
            db = null;
        }
    });

    it("initializes RxDB with categories collection alongside other collections", async () => {
        db = await createQuozenDatabase({
            name: `test_db_categories_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        expect(db.collections.categories).toBeDefined();
        expect(db.collections.expenses).toBeDefined();
        expect(db.collections.settlements).toBeDefined();
        expect(db.collections.members).toBeDefined();
        expect(db.collections.user_settings).toBeDefined();
    });

    it("supports categoryToDoc and docToCategory roundtrip conversion", () => {
        const cat: ExpenseCategory = {
            id: "food_dining",
            name: "Food & Dining",
            icon: "utensils",
            description: "Restaurants and groceries",
            sortOrder: 1,
            updatedAt: new Date("2026-03-01T12:00:00.000Z")
        };

        const doc = categoryToDoc(cat, "group-123");
        expect(doc.id).toBe("group-123_food_dining");
        expect(doc.groupId).toBe("group-123");
        expect(doc.categoryId).toBe("food_dining");
        expect(doc.name).toBe("Food & Dining");
        expect(doc.icon).toBe("utensils");

        const restored = docToCategory(doc);
        expect(restored.id).toBe("food_dining");
        expect(restored.name).toBe("Food & Dining");
        expect(restored.icon).toBe("utensils");
        expect(restored.description).toBe("Restaurants and groceries");
        expect(restored.sortOrder).toBe(1);
        expect(restored.updatedAt?.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    });

    it("isolates categories by groupId in the local database", async () => {
        db = await createQuozenDatabase({
            name: `test_db_iso_cat_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        const docG1 = categoryToDoc({
            id: "food_dining",
            name: "Food G1",
            icon: "utensils",
            description: "Group 1 Food"
        }, "group-1");

        const docG2 = categoryToDoc({
            id: "food_dining",
            name: "Food G2",
            icon: "utensils",
            description: "Group 2 Food"
        }, "group-2");

        await db.collections.categories.insert(docG1);
        await db.collections.categories.insert(docG2);

        const g1Cats = await db.collections.categories.find({ selector: { groupId: "group-1" } }).exec();
        const g2Cats = await db.collections.categories.find({ selector: { groupId: "group-2" } }).exec();

        expect(g1Cats).toHaveLength(1);
        expect(g1Cats[0].name).toBe("Food G1");
        expect(g2Cats).toHaveLength(1);
        expect(g2Cats[0].name).toBe("Food G2");
    });

    it("migrates v0 expense categories to v1 readable IDs on database open", async () => {
        const storage = getRxStorageMemory();
        const dbName = `test_rxdb_mig_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // 1. Manually open a v0 database with v0 expense schema
        const v0ExpenseSchema = {
            title: "expenses",
            version: 0,
            primaryKey: "id",
            type: "object",
            properties: {
                id: { type: "string", maxLength: 100 },
                groupId: { type: "string", maxLength: 100 },
                description: { type: "string" },
                amount: { type: "number" },
                category: { type: "string" },
                date: { type: "string", maxLength: 50 },
                paidByUserId: { type: "string" },
                splits: { type: "array" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
                deletedAt: { type: ["string", "null"] }
            },
            required: ["id", "groupId", "description", "amount", "category", "date", "paidByUserId", "splits", "createdAt", "updatedAt"]
        };

        const dbV0 = await createRxDatabase({
            name: dbName,
            storage
        });

        await dbV0.addCollections({
            expenses: {
                schema: v0ExpenseSchema
            }
        });

        const nowIso = "2026-02-01T00:00:00.000Z";
        await dbV0.expenses.insert({
            id: "legacy-exp-food",
            groupId: "group-mig",
            description: "Tacos",
            amount: 25,
            category: "Food & Dining", // Legacy free text
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 25 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await dbV0.expenses.insert({
            id: "legacy-exp-custom",
            groupId: "group-mig",
            description: "Mystery item",
            amount: 10,
            category: "CompletelyUnknownCategory123", // Unknown category
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 10 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await dbV0.close();

        // 2. Open via createQuozenDatabase (which uses v1 schema + migration strategy)
        db = await createQuozenDatabase({
            name: dbName,
            storage
        });

        const expFood = await db.expenses.findOne("legacy-exp-food").exec();
        const expCustom = await db.expenses.findOne("legacy-exp-custom").exec();

        expect(expFood).not.toBeNull();
        expect(expFood?.category).toBe("food_dining");

        expect(expCustom).not.toBeNull();
        expect(expCustom?.category).toBe("other");
    });

    it("CategoryIntegrityReconciler restores missing in-use categories automatically", async () => {
        db = await createQuozenDatabase({
            name: `test_reconcile_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        const nowIso = new Date().toISOString();
        const groupId = "group-heal";

        // Insert expenses with categories without inserting the categories first
        await db.expenses.insert({
            id: "exp-1",
            groupId,
            description: "Dinner",
            amount: 50,
            category: "food_dining", // Standard default
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 50 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await db.expenses.insert({
            id: "exp-2",
            groupId,
            description: "Custom gear",
            amount: 120,
            category: "scuba_gear", // Custom category
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 120 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        // Run reconciliation
        const result = await CategoryIntegrityReconciler.reconcile(db, groupId);

        expect(result.restoredCategories).toHaveLength(2);
        expect(result.restoredCategories).toEqual(expect.arrayContaining(["food_dining", "scuba_gear"]));

        // Verify categories exist in collection
        const foodCat = await db.collections.categories.findOne(`${groupId}_food_dining`).exec();
        expect(foodCat).not.toBeNull();
        expect(foodCat?.name).toBe("Food & Dining");
        expect(foodCat?.icon).toBe("utensils");

        const customCat = await db.collections.categories.findOne(`${groupId}_scuba_gear`).exec();
        expect(customCat).not.toBeNull();
        expect(customCat?.name).toBe("Scuba Gear");
        expect(customCat?.icon).toBe("tag");

        // Running reconciliation again is idempotent
        const secondResult = await CategoryIntegrityReconciler.reconcile(db, groupId);
        expect(secondResult.restoredCategories).toHaveLength(0);
    });

    it("CategoryIntegrityReconciler normalizes legacy category names in expenses to canonical IDs without creating duplicate Restored category entries", async () => {
        db = await createQuozenDatabase({
            name: `test_reconcile_legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        const nowIso = new Date().toISOString();
        const groupId = "group-legacy-cat";

        // Seed default categories
        const cDocs = DEFAULT_CATEGORIES.map(c => categoryToDoc(c, groupId));
        await db.collections.categories.bulkUpsert(cDocs);

        // Insert expenses with legacy title-case categories as found in pre-migrated sheets
        await db.expenses.insert({
            id: "exp-legacy-food",
            groupId,
            description: "Dinner",
            amount: 50,
            category: "Food & Dining", // Legacy title case
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 50 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await db.expenses.insert({
            id: "exp-legacy-trans",
            groupId,
            description: "Taxi",
            amount: 30,
            category: "Transportation", // Legacy title case
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 30 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await db.expenses.insert({
            id: "exp-legacy-accom",
            groupId,
            description: "Hotel",
            amount: 100,
            category: "Accommodation", // Legacy title case
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 100 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await db.expenses.insert({
            id: "exp-legacy-shop",
            groupId,
            description: "Mall",
            amount: 40,
            category: "Shopping", // Legacy title case
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 40 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        // Run reconciliation
        const result = await CategoryIntegrityReconciler.reconcile(db, groupId);

        // Must NOT restore duplicates
        expect(result.restoredCategories).toEqual([]);
        expect(result.healedExpensesCount).toBe(4);

        // Verify expenses were normalized to canonical IDs
        const expFood = await db.expenses.findOne("exp-legacy-food").exec();
        expect(expFood?.category).toBe("food_dining");

        const expTrans = await db.expenses.findOne("exp-legacy-trans").exec();
        expect(expTrans?.category).toBe("transportation");

        const expAccom = await db.expenses.findOne("exp-legacy-accom").exec();
        expect(expAccom?.category).toBe("accommodation");

        const expShop = await db.expenses.findOne("exp-legacy-shop").exec();
        expect(expShop?.category).toBe("shopping");

        // Verify no duplicate categories exist
        const allCats = await db.collections.categories.find({ selector: { groupId, deletedAt: null } }).exec();
        expect(allCats.length).toBe(DEFAULT_CATEGORIES.length);
        const restoredCats = allCats.filter(c => c.description === "Restored category");
        expect(restoredCats).toHaveLength(0);
    });

    it("CategoryIntegrityReconciler cleans up existing duplicate categories and re-points expenses", async () => {
        db = await createQuozenDatabase({
            name: `test_reconcile_dedup_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        const nowIso = new Date().toISOString();
        const groupId = "group-dedup";

        // Seed default categories
        const cDocs = DEFAULT_CATEGORIES.map(c => categoryToDoc(c, groupId));
        await db.collections.categories.bulkUpsert(cDocs);

        // Simulate duplicate restored categories already present in database (user's reported scenario)
        const duplicateDocs = [
            categoryToDoc({ id: "Food & Dining", name: "Food & dining", icon: "tag", description: "Restored category" }, groupId),
            categoryToDoc({ id: "Accommodation", name: "Accommodation", icon: "tag", description: "Restored category" }, groupId),
            categoryToDoc({ id: "Transportation", name: "Transportation", icon: "tag", description: "Restored category" }, groupId),
            categoryToDoc({ id: "Shopping", name: "Shopping", icon: "tag", description: "Restored category" }, groupId)
        ];
        await db.collections.categories.bulkUpsert(duplicateDocs);

        // Expenses pointing to the duplicate category IDs
        await db.expenses.insert({
            id: "exp-1",
            groupId,
            description: "Dinner",
            amount: 50,
            category: "Food & Dining",
            date: nowIso,
            paidByUserId: "u1",
            splits: [{ userId: "u1", amount: 50 }],
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        // Run reconciliation
        const result = await CategoryIntegrityReconciler.reconcile(db, groupId);

        // Expense should be remapped to canonical id
        const exp = await db.expenses.findOne("exp-1").exec();
        expect(exp?.category).toBe("food_dining");

        // Duplicate categories should be soft-deleted (deletedAt != null)
        const activeCats = await db.collections.categories.find({ selector: { groupId, deletedAt: null } }).exec();
        expect(activeCats.length).toBe(DEFAULT_CATEGORIES.length);
        expect(activeCats.some(c => c.categoryId === "Food & Dining")).toBe(false);

        const dupDoc = await db.collections.categories.findOne(`${groupId}_Food & Dining`).exec();
        expect(dupDoc?.deletedAt).not.toBeNull();
    });
});
