import { Migration, GoogleSheetsFetchClient } from "@qozara/gdocs-schema";

export const META_TAB_HEADERS = ["key", "value", "updatedAt"];

export const migration_3: Migration = {
    version: 3,
    up: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        const meta = await client.getSpreadsheet(spreadsheetId);
        const sheets = meta.sheets || [];
        let metaSheet = sheets.find((s: any) => s.properties?.title === "_meta");
        let sheetId = metaSheet?.properties?.sheetId;

        if (!metaSheet) {
            const addResult = await client.batchUpdate(spreadsheetId, [
                {
                    addSheet: {
                        properties: {
                            title: "_meta",
                            gridProperties: { frozenRowCount: 1 }
                        }
                    }
                }
            ]);
            sheetId = addResult?.replies?.[0]?.addSheet?.properties?.sheetId;
        }

        const batchRes = await client.batchGet(spreadsheetId, ["_meta!A1:C1"]);
        const rows = batchRes.valueRanges?.[0]?.values || [];

        if (rows.length === 0 || !rows[0] || rows[0].length === 0) {
            if (sheetId === undefined) {
                const refreshed = await client.getSpreadsheet(spreadsheetId);
                const found = refreshed.sheets?.find((s: any) => s.properties?.title === "_meta");
                sheetId = found?.properties?.sheetId;
            }

            if (sheetId !== undefined) {
                await client.batchUpdate(spreadsheetId, [
                    {
                        appendCells: {
                            sheetId,
                            rows: [
                                {
                                    values: META_TAB_HEADERS.map(h => ({
                                        userEnteredValue: { stringValue: h }
                                    }))
                                }
                            ],
                            fields: "userEnteredValue"
                        }
                    }
                ]);
            }
        }
    },
    down: async (client: GoogleSheetsFetchClient, spreadsheetId: string) => {
        const meta = await client.getSpreadsheet(spreadsheetId);
        const metaSheet = meta.sheets?.find((s: any) => s.properties?.title === "_meta");
        if (metaSheet && metaSheet.properties?.sheetId !== undefined) {
            await client.batchUpdate(spreadsheetId, [
                {
                    deleteSheet: {
                        sheetId: metaSheet.properties.sheetId
                    }
                }
            ]);
        }
    }
};
