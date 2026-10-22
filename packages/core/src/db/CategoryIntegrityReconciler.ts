import type { QuozenDatabase } from "./database";
import { categoryToDoc } from "./schemas";
import { DEFAULT_CATEGORIES, humanizeCategoryId } from "../domain/categories";

export interface CategoryReconciliationResult {
    restoredCategories: string[];
    healedExpensesCount: number;
}

export class CategoryIntegrityReconciler {
    /**
     * Reconciles categories for a given group.
     * Ensures all categories referenced by active expenses exist in the local categories collection.
     * If an in-use category was deleted or missing, restores it automatically.
     */
    static async reconcile(db: QuozenDatabase, groupId: string): Promise<CategoryReconciliationResult> {
        const restoredCategories: string[] = [];
        let healedExpensesCount = 0;

        // 1. Fetch all active expenses for this group
        const expenses = await db.expenses
            .find({
                selector: {
                    groupId,
                    deletedAt: null
                }
            })
            .exec();

        // 2. Fetch all active categories for this group
        const categories = await db.collections.categories
            .find({
                selector: {
                    groupId,
                    deletedAt: null
                }
            })
            .exec();

        const existingCategoryIds = new Set(categories.map(c => c.categoryId));
        const defaultCategoryMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));

        // 3. Find unique categories used in expenses and heal any empty categories
        const usedCategoryIds = new Set<string>();
        for (const exp of expenses) {
            if (!exp.category) {
                await exp.patch({ category: "other" });
                healedExpensesCount++;
                usedCategoryIds.add("other");
            } else {
                usedCategoryIds.add(exp.category);
            }
        }

        // 4. Restore any missing category that is used in expenses
        for (const catId of usedCategoryIds) {
            if (!existingCategoryIds.has(catId)) {
                const defaultDef = defaultCategoryMap.get(catId as any);
                const restoredCat = defaultDef
                    ? { ...defaultDef }
                    : {
                          id: catId,
                          name: humanizeCategoryId(catId),
                          icon: "tag",
                          description: "Restored category",
                          sortOrder: 99
                      };

                const doc = categoryToDoc(restoredCat, groupId);
                await db.collections.categories.upsert(doc);
                existingCategoryIds.add(catId);
                restoredCategories.push(catId);
            }
        }

        return {
            restoredCategories,
            healedExpensesCount
        };
    }
}
