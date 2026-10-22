import { Migration, GoogleSheetsFetchClient } from "@qozara/gdocs-schema";
import { ensureCategoriesTab } from "./categoriesTab";
import { normalizeLegacyCategory } from "../../domain/categories";

export const migration_2: Migration = {
    version: 2,
    up: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        // 1. Ensure Categories tab exists with default categories
        await ensureCategoriesTab(client, spreadsheetId);

        // 2. Fetch Expenses rows
        const meta = await client.getSpreadsheet(spreadsheetId);
        const expensesSheet = meta.sheets?.find((s: any) => s.properties?.title === "Expenses");
        if (!expensesSheet) return;

        const sheetId = expensesSheet.properties?.sheetId;
        const res = await client.batchGet(spreadsheetId, ["Expenses!A1:Z"]);
        const rows = res.valueRanges?.[0]?.values || [];
        if (rows.length <= 1) return;

        // 3. Dynamically find the category column index
        const headers: string[] = rows[0].map((h: any) => String(h || "").trim().toLowerCase());
        const catColIndex = headers.indexOf("category");
        if (catColIndex === -1) return;

        const cellUpdates: any[] = [];

        // 4. Normalize legacy free-text categories to IDs or 'other'
        for (let rIdx = 1; rIdx < rows.length; rIdx++) {
            const rawCategory = rows[rIdx][catColIndex];
            const normalizedId = normalizeLegacyCategory(rawCategory);

            if (String(rawCategory ?? "").trim() !== normalizedId) {
                cellUpdates.push({
                    updateCells: {
                        rows: [{ values: [{ userEnteredValue: { stringValue: normalizedId } }] }],
                        fields: "userEnteredValue",
                        range: {
                            sheetId,
                            startRowIndex: rIdx,
                            endRowIndex: rIdx + 1,
                            startColumnIndex: catColIndex,
                            endColumnIndex: catColIndex + 1
                        }
                    }
                });
            }
        }

        // 5. Execute updates in chunks of 500
        const CHUNK_SIZE = 500;
        for (let i = 0; i < cellUpdates.length; i += CHUNK_SIZE) {
            const chunk = cellUpdates.slice(i, i + CHUNK_SIZE);
            await client.batchUpdate(spreadsheetId, chunk);
        }
    },
    down: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        const meta = await client.getSpreadsheet(spreadsheetId);
        const categoriesSheet = meta.sheets?.find((s: any) => s.properties?.title === "Categories");
        if (categoriesSheet) {
            await client.batchUpdate(spreadsheetId, [
                {
                    deleteSheet: {
                        sheetId: categoriesSheet.properties.sheetId
                    }
                }
            ]);
        }
    }
};
