import type { QuozenDatabase } from "./database";
import { categoryToDoc, docToCategory } from "./schemas";
import { DEFAULT_CATEGORIES, humanizeCategoryId, resolveCategory } from "../domain/categories";

export interface CategoryReconciliationResult {
    restoredCategories: string[];
    healedExpensesCount: number;
    deduplicatedCategories: string[];
}

export class CategoryIntegrityReconciler {
    /**
     * Reconciles categories for a given group.
     * Ensures all categories referenced by active expenses exist in the local categories collection.
     * Normalizes legacy category names, cleans up duplicate categories, and restores missing in-use categories.
     */
    static async reconcile(db: QuozenDatabase, groupId: string): Promise<CategoryReconciliationResult> {
        const restoredCategories: string[] = [];
        const deduplicatedCategories: string[] = [];
        let healedExpensesCount = 0;

        // 1. Fetch all active categories for this group
        const categoryDocs = await db.collections.categories
            .find({
                selector: {
                    groupId,
                    deletedAt: null
                }
            })
            .exec();

        // 2. Identify duplicate categories and map them to their canonical counterparts
        const defaultCategoryMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));
        const duplicateRemap = new Map<string, string>(); // duplicateId -> canonicalId

        const canonicalCategories = new Map<string, any>();
        const candidateDuplicates: any[] = [];

        for (const doc of categoryDocs) {
            const catId = doc.categoryId;
            const isDefault = defaultCategoryMap.has(catId as any);

            if (isDefault) {
                canonicalCategories.set(catId, doc);
            } else {
                candidateDuplicates.push(doc);
            }
        }

        const nowIso = new Date().toISOString();
        for (const candDoc of candidateDuplicates) {
            const candId = candDoc.categoryId;
            const lowerCandId = candId.toLowerCase();

            // Check if candId resolves to an existing canonical category
            const resolved = resolveCategory(
                candId,
                Array.from(canonicalCategories.values()).map(docToCategory)
            );

            let canonicalMatch = resolved ? canonicalCategories.get(resolved.id) : undefined;
            if (!canonicalMatch) {
                canonicalMatch = Array.from(canonicalCategories.values()).find(
                    c => c.categoryId.toLowerCase() === lowerCandId ||
                         (candDoc.description === "Restored category" && c.name.toLowerCase() === candDoc.name.toLowerCase())
                );
            }

            if (canonicalMatch && canonicalMatch.categoryId !== candId) {
                duplicateRemap.set(candId, canonicalMatch.categoryId);
                await candDoc.patch({ deletedAt: nowIso, updatedAt: nowIso });
                deduplicatedCategories.push(candId);
            } else {
                canonicalCategories.set(candId, candDoc);
            }
        }

        const activeCategoriesList = Array.from(canonicalCategories.values()).map(docToCategory);
        const existingCategoryIds = new Set(activeCategoriesList.map(c => c.id));

        // 3. Fetch all active expenses for this group
        const expenses = await db.expenses
            .find({
                selector: {
                    groupId,
                    deletedAt: null
                }
            })
            .exec();

        // 4. Heal expenses: handle empty categories, duplicate categories, or legacy free-text categories
        const usedCategoryIds = new Set<string>();
        for (const exp of expenses) {
            const rawCat = exp.category;
            if (!rawCat) {
                await exp.patch({ category: "other" });
                healedExpensesCount++;
                usedCategoryIds.add("other");
                continue;
            }

            // Check if pointing to a duplicate category that was remapped
            if (duplicateRemap.has(rawCat)) {
                const targetId = duplicateRemap.get(rawCat)!;
                await exp.patch({ category: targetId });
                healedExpensesCount++;
                usedCategoryIds.add(targetId);
                continue;
            }

            // Check if resolves to an active category in this group
            const resolved = resolveCategory(rawCat, activeCategoriesList);
            if (resolved) {
                if (rawCat !== resolved.id) {
                    await exp.patch({ category: resolved.id });
                    healedExpensesCount++;
                }
                usedCategoryIds.add(resolved.id);
                continue;
            }

            // Check if resolves to a default category not yet in activeCategoriesList
            const defaultResolved = resolveCategory(rawCat, DEFAULT_CATEGORIES);
            if (defaultResolved) {
                if (rawCat !== defaultResolved.id) {
                    await exp.patch({ category: defaultResolved.id });
                    healedExpensesCount++;
                }
                usedCategoryIds.add(defaultResolved.id);
                continue;
            }

            // Truly unknown custom category
            usedCategoryIds.add(rawCat);
        }

        // 5. Restore any missing category that is used in expenses
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
            healedExpensesCount,
            deduplicatedCategories
        };
    }
}
