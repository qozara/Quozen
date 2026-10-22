import { GoogleSheetsFetchClient } from "@qozara/gdocs-schema";
import { DEFAULT_CATEGORIES } from "../../domain/categories";

export const CATEGORIES_TAB_HEADERS = ["id", "name", "icon", "description", "updatedAt", "deletedAt"];

export async function ensureCategoriesTab(
    client: GoogleSheetsFetchClient,
    spreadsheetId: string
): Promise<void> {
    const meta = await client.getSpreadsheet(spreadsheetId);
    const sheets = meta.sheets || [];
    let categoriesSheet = sheets.find((s: any) => s.properties?.title === "Categories");
    let sheetId = categoriesSheet?.properties?.sheetId;

    if (!categoriesSheet) {
        const addResult = await client.batchUpdate(spreadsheetId, [
            {
                addSheet: {
                    properties: {
                        title: "Categories",
                        gridProperties: { frozenRowCount: 1 }
                    }
                }
            }
        ]);
        sheetId = addResult.replies?.[0]?.addSheet?.properties?.sheetId;
    }

    const batchRes = await client.batchGet(spreadsheetId, ["Categories!A1:F"]);
    const rows = batchRes.valueRanges?.[0]?.values || [];

    const requests: any[] = [];
    const nowIso = new Date().toISOString();

    if (rows.length === 0) {
        // Write header row and all default categories
        const headerRow = {
            values: CATEGORIES_TAB_HEADERS.map(h => ({ userEnteredValue: { stringValue: h } }))
        };
        const dataRows = DEFAULT_CATEGORIES.map(c => ({
            values: [
                { userEnteredValue: { stringValue: c.id } },
                { userEnteredValue: { stringValue: c.name } },
                { userEnteredValue: { stringValue: c.icon } },
                { userEnteredValue: { stringValue: c.description } },
                { userEnteredValue: { stringValue: nowIso } },
                { userEnteredValue: { stringValue: "" } }
            ]
        }));

        requests.push({
            updateCells: {
                rows: [headerRow, ...dataRows],
                fields: "userEnteredValue",
                range: {
                    sheetId,
                    startRowIndex: 0,
                    startColumnIndex: 0
                }
            }
        });
    } else {
        // Tab exists with some data: verify which default categories are missing
        const existingIds = new Set(
            rows.slice(1).map((r: any[]) => String(r[0] || "").trim())
        );

        const missingDefaults = DEFAULT_CATEGORIES.filter(c => !existingIds.has(c.id));
        if (missingDefaults.length > 0) {
            const rowsToAppend = missingDefaults.map(c => ({
                values: [
                    { userEnteredValue: { stringValue: c.id } },
                    { userEnteredValue: { stringValue: c.name } },
                    { userEnteredValue: { stringValue: c.icon } },
                    { userEnteredValue: { stringValue: c.description } },
                    { userEnteredValue: { stringValue: nowIso } },
                    { userEnteredValue: { stringValue: "" } }
                ]
            }));

            requests.push({
                appendCells: {
                    sheetId,
                    rows: rowsToAppend,
                    fields: "userEnteredValue"
                }
            });
        }
    }

    if (requests.length > 0) {
        await client.batchUpdate(spreadsheetId, requests);
    }
}
