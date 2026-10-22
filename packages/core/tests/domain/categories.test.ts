import { describe, it, expect } from "vitest";
import {
    DEFAULT_CATEGORIES,
    DEFAULT_CATEGORY_ID,
    normalizeLegacyCategory,
    resolveCategory,
    isValidCategoryId,
    humanizeCategoryId,
    ExpenseCategory
} from "../../src/domain/categories";
import { Ledger, LedgerData } from "../../src/domain/Ledger";
import { Expense } from "../../src/domain/models";

describe("Domain: Categories", () => {
    describe("normalizeLegacyCategory", () => {
        it("normalizes empty, null, undefined, and whitespace to 'other'", () => {
            expect(normalizeLegacyCategory(null)).toBe(DEFAULT_CATEGORY_ID);
            expect(normalizeLegacyCategory(undefined)).toBe(DEFAULT_CATEGORY_ID);
            expect(normalizeLegacyCategory("")).toBe(DEFAULT_CATEGORY_ID);
            expect(normalizeLegacyCategory("   ")).toBe(DEFAULT_CATEGORY_ID);
            expect(normalizeLegacyCategory(123)).toBe(DEFAULT_CATEGORY_ID);
            expect(normalizeLegacyCategory({})).toBe(DEFAULT_CATEGORY_ID);
        });

        it("returns exact same ID for already normalized default IDs (idempotent)", () => {
            const defaultIds = [
                "food_dining",
                "transportation",
                "accommodation",
                "entertainment",
                "shopping",
                "other"
            ];
            for (const id of defaultIds) {
                expect(normalizeLegacyCategory(id)).toBe(id);
            }
        });

        it("maps case-insensitive synonyms accurately", () => {
            expect(normalizeLegacyCategory("Food")).toBe("food_dining");
            expect(normalizeLegacyCategory("FOOD & DINING")).toBe("food_dining");
            expect(normalizeLegacyCategory("comida")).toBe("food_dining");
            expect(normalizeLegacyCategory("groceries")).toBe("food_dining");
            expect(normalizeLegacyCategory("restaurant")).toBe("food_dining");

            expect(normalizeLegacyCategory("Travel")).toBe("transportation");
            expect(normalizeLegacyCategory("fuel")).toBe("transportation");
            expect(normalizeLegacyCategory("gas")).toBe("transportation");

            expect(normalizeLegacyCategory("Lodging")).toBe("accommodation");
            expect(normalizeLegacyCategory("hotel")).toBe("accommodation");

            expect(normalizeLegacyCategory("Leisure")).toBe("entertainment");
            expect(normalizeLegacyCategory("tickets")).toBe("entertainment");

            expect(normalizeLegacyCategory("Compras")).toBe("shopping");
            expect(normalizeLegacyCategory("purchases")).toBe("shopping");

            expect(normalizeLegacyCategory("Misc")).toBe("other");
            expect(normalizeLegacyCategory("miscellaneous")).toBe("other");
        });

        it("strips accents when mapping categories", () => {
            expect(normalizeLegacyCategory("Café")).toBe("food_dining");
            expect(normalizeLegacyCategory("café")).toBe("food_dining");
            expect(normalizeLegacyCategory("Alojamiento")).toBe("accommodation");
            expect(normalizeLegacyCategory("alojamiento")).toBe("accommodation");
            expect(normalizeLegacyCategory("Diversión")).toBe("entertainment");
        });

        it("deterministically maps unknown legacy categories to 'other'", () => {
            expect(normalizeLegacyCategory("Pizza Night")).toBe("other");
            expect(normalizeLegacyCategory("Space Travel")).toBe("other");
            expect(normalizeLegacyCategory("Random 123")).toBe("other");
            expect(normalizeLegacyCategory("Unclassified XYZ")).toBe("other");
        });
    });

    describe("resolveCategory", () => {
        it("resolves by exact ID match", () => {
            const result = resolveCategory("food_dining", DEFAULT_CATEGORIES);
            expect(result).toBeDefined();
            expect(result?.id).toBe("food_dining");
            expect(result?.name).toBe("Food & Dining");

            const customCategory: ExpenseCategory = {
                id: "custom_subs",
                name: "Subscriptions",
                icon: "credit-card",
                description: "Monthly SaaS"
            };
            const customResult = resolveCategory("custom_subs", [...DEFAULT_CATEGORIES, customCategory]);
            expect(customResult).toBeDefined();
            expect(customResult?.id).toBe("custom_subs");
        });

        it("resolves by case-insensitive name match", () => {
            const result = resolveCategory("Food & Dining", DEFAULT_CATEGORIES);
            expect(result?.id).toBe("food_dining");

            const upperResult = resolveCategory("ENTERTAINMENT", DEFAULT_CATEGORIES);
            expect(upperResult?.id).toBe("entertainment");
        });

        it("resolves by fallback synonym match", () => {
            const groceriesResult = resolveCategory("groceries", DEFAULT_CATEGORIES);
            expect(groceriesResult?.id).toBe("food_dining");

            const travelResult = resolveCategory("Travel", DEFAULT_CATEGORIES);
            expect(travelResult?.id).toBe("transportation");

            const accentResult = resolveCategory("Café", DEFAULT_CATEGORIES);
            expect(accentResult?.id).toBe("food_dining");
        });

        it("returns undefined if no category matches", () => {
            expect(resolveCategory("Random 123", DEFAULT_CATEGORIES)).toBeUndefined();
            expect(resolveCategory("", DEFAULT_CATEGORIES)).toBeUndefined();
            expect(resolveCategory(null, DEFAULT_CATEGORIES)).toBeUndefined();
            expect(resolveCategory("unknown_category", DEFAULT_CATEGORIES)).toBeUndefined();
        });
    });

    describe("isValidCategoryId & humanizeCategoryId", () => {
        it("validates category IDs properly", () => {
            expect(isValidCategoryId("food_dining")).toBe(true);
            expect(isValidCategoryId("transportation")).toBe(true);
            expect(isValidCategoryId("custom-123")).toBe(true);
            expect(isValidCategoryId("valid_category_name")).toBe(true);

            expect(isValidCategoryId("")).toBe(false);
            expect(isValidCategoryId("   ")).toBe(false);
            expect(isValidCategoryId("invalid with spaces")).toBe(false);
            expect(isValidCategoryId("special!@#")).toBe(false);
        });

        it("humanizes category IDs into readable titles", () => {
            expect(humanizeCategoryId("food_dining")).toBe("Food & Dining");
            expect(humanizeCategoryId("transportation")).toBe("Transportation");
            expect(humanizeCategoryId("custom_service")).toBe("Custom Service");
            expect(humanizeCategoryId("other")).toBe("Other");
        });
    });

    describe("Ledger Integration", () => {
        const mockExpense = (id: string, category: string): Expense => ({
            id,
            description: "Test Expense",
            amount: 100,
            category,
            date: new Date(),
            paidByUserId: "user-1",
            splits: [{ userId: "user-1", amount: 100 }],
            createdAt: new Date(),
            updatedAt: new Date()
        });

        it("defaults ledger.categories to DEFAULT_CATEGORIES if not provided", () => {
            const ledgerData: LedgerData = {
                expenses: [],
                settlements: [],
                members: []
            };
            const ledger = new Ledger(ledgerData);
            expect(ledger.categories).toEqual(DEFAULT_CATEGORIES);
            expect(ledger.categories).toHaveLength(6);
        });

        it("uses custom categories when provided in LedgerData", () => {
            const customCategories: ExpenseCategory[] = [
                { id: "cat-1", name: "Custom 1", icon: "star", description: "Desc 1" }
            ];
            const ledgerData: LedgerData = {
                expenses: [],
                settlements: [],
                members: [],
                categories: customCategories
            };
            const ledger = new Ledger(ledgerData);
            expect(ledger.categories).toEqual(customCategories);
        });

        it("finds category by id using ledger.getCategory", () => {
            const ledger = new Ledger({
                expenses: [],
                settlements: [],
                members: []
            });
            expect(ledger.getCategory("food_dining")?.name).toBe("Food & Dining");
            expect(ledger.getCategory("non_existent")).toBeUndefined();
        });

        it("flags expenses with invalid category IDs via ledger.getInvalidCategoryExpenseIds()", () => {
            const ledger = new Ledger({
                expenses: [
                    mockExpense("exp-1", "food_dining"),
                    mockExpense("exp-2", "unknown_category_legacy"),
                    mockExpense("exp-3", "shopping"),
                    mockExpense("exp-4", "invalid_123")
                ],
                settlements: [],
                members: []
            });

            const invalidIds = ledger.getInvalidCategoryExpenseIds();
            expect(invalidIds).toEqual(["exp-2", "exp-4"]);
        });
    });
});
