# Schema Migrations

Quozen core uses `@qozara/gdocs-schema` to handle programmatic schema migrations for our Google Spreadsheet-based groups. This allows the app to evolve the data schema (tabs, columns) over time without breaking existing files in users' Google Drives.

## How it works

The Quozen schema is strictly defined in `packages/core/src/schema/SchemaDefinition.ts`. The schema version and structure are used to validate any opened Google Spreadsheet.
If the validation service determines a spreadsheet is outdated, the user can upgrade their sheet using the migration system.

## Modifying the Schema

Whenever you need to add, rename, or remove a column, or add a new tab:

1. Open `packages/core/src/schema/SchemaDefinition.ts`.
2. Increment the `version` number (e.g. from `1` to `2`).
3. Modify the `tabs` or `columns` arrays to reflect the new structure.

## Writing a Migration

For every schema version increment, you **must** write a migration that automatically translates existing data from the previous version to the new version.

1. Create a new file in `packages/core/src/schema/migrations/`, e.g., `2_add_currency_column.ts`.
2. Follow this template:

```typescript
import { Migration } from "@qozara/gdocs-schema";

export const migration_2: Migration = {
    version: 2,
    up: async (client, spreadsheetId) => {
        // e.g. Append a column to the 'Expenses' sheet
        const meta = await client.getSpreadsheet(spreadsheetId);
        const expensesTab = meta.sheets.find((s: any) => s.properties.title === 'Expenses');

        await client.batchUpdate(spreadsheetId, [
            {
                appendDimension: {
                    sheetId: expensesTab.properties.sheetId,
                    dimension: 'COLUMNS',
                    length: 1
                }
            },
            {
                updateCells: {
                    rows: [{ values: [{ userEnteredValue: { stringValue: 'currency' } }] }],
                    fields: 'userEnteredValue',
                    range: {
                        sheetId: expensesTab.properties.sheetId,
                        startRowIndex: 0,
                        endRowIndex: 1,
                        startColumnIndex: 8 // Assuming we had 8 columns previously
                    }
                }
            }
        ]);
    },
    down: async (client, spreadsheetId) => {
        // Revert operations here if needed
    }
};
```

3. Open `packages/core/src/schema/migrations/index.ts` and add your migration to the `migrations` array:

```typescript
import { migration_2 } from "./2_add_currency_column";

export const migrations: Migration[] = [
    migration_2
];
```

## Testing Migrations

You can use the CLI to test your migrations locally:
```bash
npm run cli -- validate <spreadsheetId>
npm run cli -- repair <spreadsheetId>
```
