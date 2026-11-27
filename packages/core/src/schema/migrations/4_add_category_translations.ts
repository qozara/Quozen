import { GoogleSheetsFetchClient, type SchemaMigration } from "@qozara/cloud-sync-google";
import { DEFAULT_CATEGORIES } from "../../domain/categories";

export const migration_4: SchemaMigration = {
    version: 4,
    up: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        const meta = await client.getSpreadsheet(spreadsheetId);
        const sheets = meta.sheets || [];
        const categoriesSheet = sheets.find(
            (s: any) => s.properties?.title?.trim().toLowerCase() === "categories"
        );
        if (!categoriesSheet || categoriesSheet.properties?.sheetId === undefined) {
            return;
        }

        const sheetId = categoriesSheet.properties.sheetId;
        const sheetTitle = categoriesSheet.properties.title;
        let currentColCount: number = categoriesSheet.properties?.gridProperties?.columnCount ?? 6;

        const batchRes = await client.batchGet(spreadsheetId, [`${sheetTitle}!A1:Z`]);
        const rows: any[][] = batchRes.valueRanges?.[0]?.values || [];
        if (rows.length === 0) return;

        const headers = (rows[0] || []).map((h: any) => String(h ?? "").trim());
        const findCol = (name: string) =>
            headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

        const idIdx = findCol("id");
        const nameIdx = findCol("name");
        const descIdx = findCol("description");
        if (idIdx === -1 || nameIdx === -1) return;

        const requests: any[] = [];

        const ensureColumn = (colName: string): number => {
            const existing = findCol(colName);
            if (existing !== -1) return existing;

            const newIdx = headers.length;
            headers.push(colName);
            if (newIdx >= currentColCount) {
                const extra = newIdx - currentColCount + 1;
                requests.push({
                    appendDimension: {
                        sheetId,
                        dimension: "COLUMNS",
                        length: extra
                    }
                });
                currentColCount += extra;
            }
            requests.push({
                updateCells: {
                    rows: [{ values: [{ userEnteredValue: { stringValue: colName } }] }],
                    fields: "userEnteredValue",
                    range: {
                        sheetId,
                        startRowIndex: 0,
                        endRowIndex: 1,
                        startColumnIndex: newIdx,
                        endColumnIndex: newIdx + 1
                    }
                }
            });
            return newIdx;
        };

        const nameEsIdx = ensureColumn("name_es");
        const descEsIdx = ensureColumn("description_es");

        const defaultMap = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c]));

        for (let rIdx = 1; rIdx < rows.length; rIdx++) {
            const row = rows[rIdx] || [];
            const catId = String(row[idIdx] ?? "").trim();
            const defaultCat = defaultMap.get(catId);
            if (!defaultCat) continue;

            const rawName = String(row[nameIdx] ?? "").trim();
            const rawNameEs = String(row[nameEsIdx] ?? "").trim();
            if (!rawNameEs && (!rawName || rawName === defaultCat.name) && defaultCat.translations?.es) {
                requests.push({
                    updateCells: {
                        rows: [{ values: [{ userEnteredValue: { stringValue: defaultCat.translations.es } }] }],
                        fields: "userEnteredValue",
                        range: {
                            sheetId,
                            startRowIndex: rIdx,
                            endRowIndex: rIdx + 1,
                            startColumnIndex: nameEsIdx,
                            endColumnIndex: nameEsIdx + 1
                        }
                    }
                });
            }

            const rawDesc = descIdx !== -1 ? String(row[descIdx] ?? "").trim() : "";
            const rawDescEs = String(row[descEsIdx] ?? "").trim();
            if (!rawDescEs && (!rawDesc || rawDesc === defaultCat.description) && defaultCat.descriptionTranslations?.es) {
                requests.push({
                    updateCells: {
                        rows: [{ values: [{ userEnteredValue: { stringValue: defaultCat.descriptionTranslations.es } }] }],
                        fields: "userEnteredValue",
                        range: {
                            sheetId,
                            startRowIndex: rIdx,
                            endRowIndex: rIdx + 1,
                            startColumnIndex: descEsIdx,
                            endColumnIndex: descEsIdx + 1
                        }
                    }
                });
            }
        }

        if (requests.length > 0) {
            await client.batchUpdate(spreadsheetId, requests);
        }
    },
    down: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        const meta = await client.getSpreadsheet(spreadsheetId);
        const categoriesSheet = meta.sheets?.find(
            (s: any) => s.properties?.title?.trim().toLowerCase() === "categories"
        );
        if (!categoriesSheet || categoriesSheet.properties?.sheetId === undefined) {
            return;
        }

        const sheetId = categoriesSheet.properties.sheetId;
        const sheetTitle = categoriesSheet.properties.title;
        const batchRes = await client.batchGet(spreadsheetId, [`${sheetTitle}!A1:Z1`]);
        const headers = (batchRes.valueRanges?.[0]?.values?.[0] || []).map((h: any) =>
            String(h ?? "").trim().toLowerCase()
        );

        const colsToDelete = ["name_es", "description_es"]
            .map(col => headers.indexOf(col))
            .filter(idx => idx !== -1)
            .sort((a, b) => b - a);

        if (colsToDelete.length > 0) {
            await client.batchUpdate(
                spreadsheetId,
                colsToDelete.map(colIdx => ({
                    deleteDimension: {
                        range: {
                            sheetId,
                            dimension: "COLUMNS",
                            startIndex: colIdx,
                            endIndex: colIdx + 1
                        }
                    }
                }))
            );
        }
    }
};
