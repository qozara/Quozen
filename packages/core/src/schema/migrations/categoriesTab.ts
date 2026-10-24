import { GoogleSheetsFetchClient } from "@qozara/gdocs-schema";
import { DEFAULT_CATEGORIES, resolveCategory } from "../../domain/categories";

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
        // Deduplicate any duplicate restored categories that match canonical categories
        const defaultMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));
        const rowsToDelete: number[] = []; // 0-based row indices in spreadsheet
        const keptIds = new Set<string>();

        // Row 0 is header
        for (let rIdx = 1; rIdx < rows.length; rIdx++) {
            const row = rows[rIdx];
            const catId = String(row[0] || "").trim();
            const desc = String(row[3] || "").trim();

            if (!catId) {
                rowsToDelete.push(rIdx);
                continue;
            }

            const isDefault = defaultMap.has(catId as any);
            if (isDefault) {
                if (keptIds.has(catId)) {
                    rowsToDelete.push(rIdx);
                } else {
                    keptIds.add(catId);
                }
            } else if (desc === "Restored category") {
                // Check if this restored category is a duplicate of a default category
                const matched = resolveCategory(catId, DEFAULT_CATEGORIES);
                if (matched && keptIds.has(matched.id)) {
                    rowsToDelete.push(rIdx);
                } else if (matched) {
                    rowsToDelete.push(rIdx);
                } else if (keptIds.has(catId.toLowerCase())) {
                    rowsToDelete.push(rIdx);
                } else {
                    keptIds.add(catId);
                }
            } else {
                if (keptIds.has(catId)) {
                    rowsToDelete.push(rIdx);
                } else {
                    keptIds.add(catId);
                }
            }
        }

        // Delete duplicates in reverse order so row indices don't shift
        for (let i = rowsToDelete.length - 1; i >= 0; i--) {
            const rowIndex = rowsToDelete[i];
            requests.push({
                deleteDimension: {
                    range: {
                        sheetId,
                        dimension: "ROWS",
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1
                    }
                }
            });
        }

        // Tab exists: verify which default categories are missing
        const missingDefaults = DEFAULT_CATEGORIES.filter(c => !keptIds.has(c.id));
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
