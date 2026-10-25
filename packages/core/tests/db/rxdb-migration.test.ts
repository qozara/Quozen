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

    it("migrates v0 user_settings (legacy schema without preferencesUpdatedAt or extended groupCache fields) to v1 without DB6 error", async () => {
        const storage = getRxStorageMemory();
        const dbName = `test_rxdb_usersettings_mig_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // 1. Open database with the exact legacy v0 user_settings schema from production before PR #70
        const legacyV0UserSettingsSchema = {
            title: "user_settings",
            version: 0,
            description: "Global user preferences and cached group metadata stored locally and in Drive appDataFolder",
            primaryKey: "id",
            type: "object",
            properties: {
                id: { type: "string", maxLength: 100 },
                version: { type: "number", minimum: 1 },
                activeGroupId: { type: ["string", "null"] },
                groupCache: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            role: { type: "string", enum: ["owner", "member"] },
                            lastAccessed: { type: "string" },
                            validationStatus: { type: "string" }
                        },
                        required: ["id", "name", "role"]
                    }
                },
                preferences: {
                    type: "object",
                    properties: {
                        defaultCurrency: { type: "string" },
                        theme: { type: "string" },
                        locale: { type: "string" },
                        aiProvider: { type: "string" },
                        ollamaBaseUrl: { type: "string" },
                        ollamaModel: { type: "string" },
                        byokProvider: { type: "string" }
                    },
                    required: ["defaultCurrency"]
                },
                encryptedApiKey: { type: "string" },
                lastUpdated: { type: "string" },
                updatedAt: { type: "string" },
                deletedAt: { type: ["string", "null"] }
            },
            required: ["id", "version", "groupCache", "preferences", "lastUpdated", "updatedAt"]
        };

        const dbV0 = await createRxDatabase({
            name: dbName,
            storage
        });

        await dbV0.addCollections({
            user_settings: {
                schema: legacyV0UserSettingsSchema
            }
        });

        const nowIso = "2026-02-01T00:00:00.000Z";
        await dbV0.user_settings.insert({
            id: "global_settings",
            version: 1,
            activeGroupId: "group-1",
            groupCache: [
                {
                    id: "group-1",
                    name: "Trip to Japan",
                    role: "owner",
                    lastAccessed: nowIso,
                    validationStatus: "READY"
                }
            ],
            preferences: {
                defaultCurrency: "EUR",
                theme: "dark",
                locale: "es"
            },
            lastUpdated: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await dbV0.close();

        // 2. Re-open via createQuozenDatabase (must migrate v0 -> v1 without throwing DB6)
        db = await createQuozenDatabase({
            name: dbName,
            storage
        });

        const migratedSettings = await db.user_settings.findOne("global_settings").exec();
        expect(migratedSettings).not.toBeNull();
        expect(migratedSettings?.activeGroupId).toBe("group-1");
        expect(migratedSettings?.preferences.defaultCurrency).toBe("EUR");
        expect(migratedSettings?.preferences.theme).toBe("dark");
        expect(migratedSettings?.preferencesUpdatedAt).toBe(nowIso);
        expect(migratedSettings?.groupCache).toHaveLength(1);
        expect(migratedSettings?.groupCache[0].name).toBe("Trip to Japan");
        expect(migratedSettings?.groupCache[0].updatedAt).toBe(nowIso);
    });

    it("migrates intermediate v0 user_settings (PR #70 schema at v0) to v1 without DB6 error", async () => {
        const storage = getRxStorageMemory();
        const dbName = `test_rxdb_usersettings_mig_inter_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const intermediateV0UserSettingsSchema = {
            title: "user_settings",
            version: 0,
            description: "Global user preferences and cached group metadata stored locally and in Drive appDataFolder",
            primaryKey: "id",
            type: "object",
            properties: {
                id: { type: "string", maxLength: 100 },
                version: { type: "number", minimum: 1 },
                activeGroupId: { type: ["string", "null"] },
                groupCache: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            role: { type: "string", enum: ["owner", "member"] },
                            accountId: { type: "string" },
                            lastAccessed: { type: "string" },
                            validationStatus: { type: "string" },
                            isHydrated: { type: "boolean" },
                            pendingRename: { type: "boolean" },
                            updatedAt: { type: "string" }
                        },
                        required: ["id", "name", "role"]
                    }
                },
                preferences: {
                    type: "object",
                    properties: {
                        defaultCurrency: { type: "string" },
                        theme: { type: "string" },
                        locale: { type: "string" },
                        aiProvider: { type: "string" },
                        ollamaBaseUrl: { type: "string" },
                        ollamaModel: { type: "string" },
                        byokProvider: { type: "string" }
                    },
                    required: ["defaultCurrency"]
                },
                encryptedApiKey: { type: "string" },
                preferencesUpdatedAt: { type: "string" },
                lastUpdated: { type: "string" },
                updatedAt: { type: "string" },
                deletedAt: { type: ["string", "null"] }
            },
            required: ["id", "version", "groupCache", "preferences", "lastUpdated", "updatedAt"]
        };

        const dbV0 = await createRxDatabase({
            name: dbName,
            storage
        });

        await dbV0.addCollections({
            user_settings: {
                schema: intermediateV0UserSettingsSchema
            }
        });

        const nowIso = "2026-10-24T23:00:00.000Z";
        await dbV0.user_settings.insert({
            id: "global_settings",
            version: 1,
            activeGroupId: "group-2",
            groupCache: [
                {
                    id: "group-2",
                    name: "Roommates",
                    role: "member",
                    accountId: "acc-1",
                    lastAccessed: nowIso,
                    validationStatus: "READY",
                    isHydrated: true,
                    pendingRename: false,
                    updatedAt: nowIso
                }
            ],
            preferences: {
                defaultCurrency: "USD",
                theme: "light"
            },
            preferencesUpdatedAt: nowIso,
            lastUpdated: nowIso,
            updatedAt: nowIso,
            deletedAt: null
        });

        await dbV0.close();

        db = await createQuozenDatabase({
            name: dbName,
            storage
        });

        const migratedSettings = await db.user_settings.findOne("global_settings").exec();
        expect(migratedSettings).not.toBeNull();
        expect(migratedSettings?.activeGroupId).toBe("group-2");
        expect(migratedSettings?.groupCache[0].accountId).toBe("acc-1");
        expect(migratedSettings?.preferencesUpdatedAt).toBe(nowIso);
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
