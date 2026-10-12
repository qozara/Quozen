import type { TabularStorageDriver, TabularRow, GoogleDriverOptions, GoogleHttpClient } from "./types";
import type { IStorageLayer } from "../infrastructure/IStorageLayer";
import { ValidationService, type SchemaStatusDTO } from "../schema/ValidationService";
import { QuozenSchema } from "../schema/SchemaDefinition";

export class GoogleSheetsTabularDriver implements TabularStorageDriver {
    id = "google-sheets-tabular";
    name = "Google Sheets Tabular Driver";

    private getAccessToken: () => string | null;
    private client: GoogleHttpClient;
    private storageLayer?: IStorageLayer;

    constructor(options: GoogleDriverOptions) {
        this.getAccessToken = options.getAccessToken;
        this.storageLayer = options.storageLayer;
        this.client = options.httpClient || {
            fetch: (url, init) => globalThis.fetch(url, init)
        };
    }

    private getAuthHeaders(): Record<string, string> {
        const token = this.getAccessToken();
        if (!token) {
            throw new Error("Google Auth Failed: Access token is missing or expired");
        }
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        };
    }

    private async handleResponseErrors(res: Response, context: string): Promise<void> {
        if (!res.ok) {
            let errText = "";
            try {
                errText = await res.text();
            } catch {}

            if (res.status === 401 || res.status === 403) {
                throw new Error(`Google Auth Failed (${res.status}) during ${context}. Details: ${errText}`);
            }
            if (res.status === 429) {
                throw new Error(`Google Sheets API Rate Limit / Quota Exceeded (429) during ${context}`);
            }
            throw new Error(`Google Sheets API Error (${res.status}) during ${context}. Details: ${errText}`);
        }
    }

    async readTable(documentId: string, tabName: string): Promise<TabularRow[]> {
        if (this.storageLayer) {
            const res = await this.storageLayer.batchGetValues(documentId, [`${tabName}!A1:Z`]);
            const values: any[][] = res[0]?.values || [];
            if (values.length <= 1) return [];
            const sheetHeaders = (values[0] || []).map(h => String(h).trim());
            this.validateHeaders(tabName, sheetHeaders);
            return values.slice(1).map(row => ({
                id: String(row[0] || ""),
                headers: sheetHeaders,
                values: row
            }));
        }

        const headers = this.getAuthHeaders();
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${documentId}/values/${encodeURIComponent(tabName)}!A1:Z`;
        const res = await this.client.fetch(url, { method: "GET", headers });
        await this.handleResponseErrors(res, `reading table "${tabName}" from document ${documentId}`);

        const json = (await res.json()) as any;
        const values: any[][] = json.values || [];
        if (values.length <= 1) return [];

        const sheetHeaders: string[] = (values[0] || []).map(h => String(h).trim());
        this.validateHeaders(tabName, sheetHeaders);

        return values.slice(1).map(row => ({
            id: String(row[0] || ""),
            headers: sheetHeaders,
            values: row
        }));
    }

    private validateHeaders(tabName: string, sheetHeaders: string[]): void {
        const headerSet = new Set(sheetHeaders.map(h => h.toLowerCase()));
        const tabDef = QuozenSchema.tabs.find(t => t.name === tabName);
        if (tabDef) {
            const missingRequired = tabDef.columns
                .filter(col => col.required && !headerSet.has(col.name.toLowerCase()))
                .map(col => col.name);

            if (missingRequired.length > 0) {
                throw new Error(
                    `Schema corruption: missing required column "${missingRequired[0]}" in tab "${tabName}". (Missing: ${missingRequired.join(", ")})`
                );
            }
        }
    }

    async writeTable(
        documentId: string,
        tabName: string,
        headers: string[],
        rows: TabularRow[]
    ): Promise<void> {
        const allValues = [headers, ...rows.map(r => r.values)];

        if (this.storageLayer) {
            // Check existing row count to clear trailing deleted rows if needed
            const existing = await this.storageLayer.batchGetValues(documentId, [`${tabName}!A1:Z`]);
            const existingRows = existing[0]?.values || [];
            await this.storageLayer.batchUpdateValues(documentId, [
                { range: `${tabName}!A1`, values: allValues }
            ]);
            if (existingRows.length > allValues.length) {
                try {
                    const sheetMeta = await this.storageLayer.getSpreadsheet(documentId, "sheets.properties");
                    const sheetId = sheetMeta.sheets?.find((s: any) => s.properties?.title === tabName)?.properties?.sheetId;
                    if (sheetId !== undefined) {
                        await this.storageLayer.batchUpdateSpreadsheet(documentId, [
                            {
                                deleteDimension: {
                                    range: {
                                        sheetId,
                                        dimension: "ROWS",
                                        startIndex: allValues.length,
                                        endIndex: existingRows.length
                                    }
                                }
                            }
                        ]);
                    }
                } catch {
                    // Non-critical cleanup
                }
            }
            await this.storageLayer.updateFile(documentId, {
                properties: { _lastSyncTrigger: new Date().toISOString() }
            }).catch(() => {});
            return;
        }

        const authHeaders = this.getAuthHeaders();
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${documentId}/values:batchUpdate`;
        const body = {
            valueInputOption: "USER_ENTERED",
            data: [
                {
                    range: `${tabName}!A1:Z`,
                    majorDimension: "ROWS",
                    values: allValues
                }
            ]
        };

        const res = await this.client.fetch(url, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(body)
        });
        await this.handleResponseErrors(res, `writing table "${tabName}" in document ${documentId}`);

        try {
            const clearRange = `${encodeURIComponent(tabName)}!A${allValues.length + 1}:Z`;
            const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${documentId}/values/${clearRange}:clear`;
            await this.client.fetch(clearUrl, {
                method: "POST",
                headers: authHeaders
            });
        } catch {
            // Non-critical trailing row cleanup
        }
    }

    async repairTable(documentId: string, expectedLastModified?: string): Promise<void> {
        const svc = new ValidationService(this.getAccessToken);
        await svc.repairFile(documentId, expectedLastModified);
    }

    async migrateTable(documentId: string, expectedLastModified?: string): Promise<void> {
        const svc = new ValidationService(this.getAccessToken);
        await svc.migrateFile(documentId, expectedLastModified);
    }

    async checkHealth(documentId: string): Promise<SchemaStatusDTO> {
        const svc = new ValidationService(this.getAccessToken);
        return await svc.checkHealth(documentId);
    }
}
