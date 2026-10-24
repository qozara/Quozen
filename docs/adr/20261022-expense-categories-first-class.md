# 20261022 - Expense Categories as First-Class Domain Model Element

## Context
Previously, expense categories in Quozen were stored as hardcoded, free-text strings (e.g. `"Food & Dining"`, `"Other"`) directly in the `Expenses` tab of the Google Spreadsheet and locally in RxDB. This caused several issues:
1. Inflexible category management across different expense groups.
2. Fragile classification, inconsistent casing/translations, and typos.
3. Lack of group-specific custom categories or icons/descriptions.

## Decision
1. **First-Class Domain Model (`ExpenseCategory`)**:
   - Added `ExpenseCategory` entity with properties: `id` (`ExpenseCategoryId` string alias, e.g. `food_dining`), `name`, `icon`, `description`, `sortOrder`, `updatedAt`, `deletedAt`.
   - `Expense.category` stores readable string ID (`food_dining`, not numeric), ensuring the Google Spreadsheet remains human-understandable without complex relational joins.

2. **Spreadsheet Schema v2 & Dual-Layer Migrations**:
   - Google Spreadsheet schema bumped to `version: 2`.
   - New `'Categories'` tab added to group spreadsheets containing headers `id`, `name`, `icon`, `description`, `updatedAt`.
   - Google Sheets migration (`migration_2`) automatically creates `'Categories'`, seeds standard defaults, and normalizes legacy expense categories in chunks.
   - RxDB `expenseSchema` bumped to `version: 1` with an automated migration strategy normalizing legacy categories.
   - RxDB registered a new partitioned `categories` collection.

3. **No Dropdowns or Sheet Constraints**:
   - Per requirements, no Google Sheets data validation dropdowns or protected ranges are injected, leaving spreadsheets unconstrained for direct editing by spreadsheet users.

4. **Self-Healing & Referential Integrity**:
   - Categories used by active expenses cannot be permanently removed.
   - If an in-use category row is deleted from the spreadsheet or missing in local RxDB, `CategoryIntegrityReconciler` automatically restores it with title-cased naming and fallback icon.

5. **AI Agent & Client Integration**:
   - `QuozenAI` dynamically passes the group's available category definitions to tool definitions and prompt context.
   - LLM tool execution normalizes synonyms or defaults to `other` to prevent invalid expense writes.
   - Webapp UI renders dynamic categories and Lucide icons via `CategoryIcon`.
   - When a legacy group is opened, schema upgrade is applied automatically in the background with toast error notifications.

## Consequences
- Data consistency across groups is guaranteed while preserving flexibility.
- Offline and local-first operations continue uninterrupted.
- Fully backward compatible with legacy spreadsheets via automated migration and graceful fallback.
