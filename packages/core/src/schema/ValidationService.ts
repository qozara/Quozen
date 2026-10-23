import {
    SchemaValidator,
    MigrationManager,
    GoogleSheetsFetchClient,
} from "@qozara/gdocs-schema";
import { QuozenSchema } from "./SchemaDefinition";
import { migrations } from "./migrations/index";
import { ensureCategoriesTab } from "./migrations/categoriesTab";
import { ConflictError, SchemaIncompatibleError } from "../errors";
import { REQUIRED_SHEETS } from "../types";

export enum ValidationStatus {
    READY = "READY",
    UPGRADE_REQUIRED = "UPGRADE_REQUIRED",
    CORRUPTED = "CORRUPTED",
    INCOMPATIBLE = "INCOMPATIBLE",
}

export interface SchemaStatusDTO {
    spreadsheetId: string;
    currentVersion: number;
    latestVersion: number;
    status: ValidationStatus;
    missingTabs: string[];
    missingColumns: Record<string, string[]>;
    canAutoMigrate: boolean;
    lastModifiedTime: string;
}

export class ValidationService {
    private client: GoogleSheetsFetchClient;
    private validator: SchemaValidator;
    private migrationManager: MigrationManager;

    constructor(getToken: () => string | null) {
        const token = getToken();
        if (!token) throw new Error("ValidationService requires a valid Google access token.");
        
        this.client = new GoogleSheetsFetchClient({
            accessToken: token,
            fetchImpl: async (url: string | Request | URL, init?: RequestInit) => {
                const finalInit = init ? { ...init } : {};
                if (finalInit.method === 'GET' && finalInit.headers) {
                    const headers = new Headers(finalInit.headers as any);
                    headers.delete('Content-Type');
                    finalInit.headers = headers;
                }
                return globalThis.fetch(url, finalInit);
            }
        });
        this.validator = new SchemaValidator(this.client);
        this.migrationManager = new MigrationManager(this.client);
    }

    public async createBackup(spreadsheetId: string, customName?: string): Promise<string> {
        let title = spreadsheetId;
        try {
            const meta = await this.client.getSpreadsheet(spreadsheetId);
            if (meta?.properties?.title) {
                title = meta.properties.title;
            }
        } catch {
            // Fallback to spreadsheetId if title cannot be fetched
        }

        const name = customName || `Backup of ${title} - ${new Date().toISOString()}`;
        let backupId = "";
        let alreadyNamed = false;

        if (typeof (this.client as any).createBackup === "function") {
            try {
                backupId = await (this.client as any).createBackup(spreadsheetId);
            } catch (err) {
                console.warn("Google Drive safety backup creation failed:", err);
                throw err;
            }
        } else if (typeof (this.client as any).request === "function") {
            try {
                const copyUrl = `https://www.googleapis.com/drive/v3/files/${spreadsheetId}/copy`;
                const result = await (this.client as any).request(copyUrl, {
                    method: "POST",
                    body: JSON.stringify({ name })
                });
                backupId = result.id;
                alreadyNamed = true;
            } catch (err) {
                console.warn("Google Drive safety backup creation failed via request:", err);
                throw err;
            }
        }

        // Ensure backup copy has human-readable title in Google Drive
        if (backupId && !alreadyNamed && typeof (this.client as any).request === "function") {
            try {
                const patchUrl = `https://www.googleapis.com/drive/v3/files/${backupId}`;
                await (this.client as any).request(patchUrl, {
                    method: "PATCH",
                    body: JSON.stringify({ name })
                });
            } catch {
                // Non-critical
            }
        }

        return backupId;
    }

    public async checkHealth(spreadsheetId: string): Promise<SchemaStatusDTO> {
        let currentVersion = 0;
        let lastModifiedTime = new Date().toISOString();
        let appProps: any = null;

        try {
            const res = await this.client.getFileAppProperties(spreadsheetId) as any;
            appProps = res.appProperties;
            if (res.modifiedTime) lastModifiedTime = res.modifiedTime;
            const parsed = parseInt(appProps?.quozen_schema_version || "0", 10);
            if (!isNaN(parsed) && parsed > 0) {
                currentVersion = parsed;
            }
        } catch {
            // Ignore error
        }

        // Two-way reconciliation: inspect spreadsheet sheets metadata and _migrations tab
        try {
            const metadata = await this.client.getSpreadsheet(spreadsheetId);
            const sheets = metadata.sheets || [];
            const sheetTitles = new Set(sheets.map((s: any) => s.properties?.title).filter(Boolean));
            const hasMigrationsTab = sheetTitles.has("_migrations");
            const hasBaselineSheets = REQUIRED_SHEETS.every(t => sheetTitles.has(t));

            if (hasMigrationsTab && typeof this.client.batchGet === "function") {
                const migrationsRes = await this.client.batchGet(spreadsheetId, ["_migrations!A2:B"]);
                const rows = migrationsRes?.valueRanges?.[0]?.values || [];
                let maxMigratedVersion = 0;
                for (const row of rows) {
                    const v = parseInt(row[0], 10);
                    if (!isNaN(v) && v > maxMigratedVersion) {
                        maxMigratedVersion = v;
                    }
                }
                if (maxMigratedVersion > currentVersion) {
                    currentVersion = maxMigratedVersion;
                    await this.client.updateFileAppProperties(spreadsheetId, {
                        quozen_schema_version: currentVersion.toString()
                    }).catch(() => {});
                }
            } else if (hasBaselineSheets && currentVersion === 0) {
                // Spreadsheet contains baseline sheets (Expenses, Members, Settlements) but lacks _migrations tab:
                // This is a pre-migration legacy Quozen group created in Schema Version 1.
                currentVersion = 1;
            }
        } catch {
            // Ignore if metadata or _migrations tab is missing or unreadable
        }

        let status = ValidationStatus.READY;
        let canAutoMigrate = false;
        let missingTabs: string[] = [];
        let missingColumns: Record<string, string[]> = {};

        if (currentVersion > QuozenSchema.version) {
            // Spreadsheet was created or migrated by a newer version of Quozen.
            // Client app code is outdated: DO NOT validate structure, repair, or auto-migrate!
            status = ValidationStatus.INCOMPATIBLE;
            canAutoMigrate = false;
        } else if (currentVersion < QuozenSchema.version) {
            // Spreadsheet migration version is behind the app's schema version.
            // This is strictly an UPGRADE_REQUIRED state that can be auto-migrated.
            // Under NO circumstance should this be marked as CORRUPTED!
            status = ValidationStatus.UPGRADE_REQUIRED;
            canAutoMigrate = true;
        } else {
            // Migration version matches the app's expected schema version.
            // Validate structure to check for manual tampering/deletions.
            const result = await this.validator.validateStructure(spreadsheetId, QuozenSchema);
            if (!result.valid) {
                status = ValidationStatus.CORRUPTED;
                missingTabs = (result as any).missingTabs || [];
                missingColumns = (result as any).missingColumns || {};
            } else {
                status = ValidationStatus.READY;
            }
        }

        return {
            spreadsheetId,
            currentVersion,
            latestVersion: QuozenSchema.version,
            status,
            missingTabs,
            missingColumns,
            canAutoMigrate,
            lastModifiedTime
        };
    }

    public async initializeFile(spreadsheetId: string, version: number = QuozenSchema.version): Promise<void> {
        // Create _migrations tab if not exists
        try {
            const addResult = await this.client.batchUpdate(spreadsheetId, [
                {
                    addSheet: {
                        properties: {
                            title: '_migrations',
                            hidden: true,
                        },
                    },
                },
            ]);

            const migrationsSheetId = addResult.replies[0].addSheet.properties.sheetId;

            await this.client.batchUpdate(spreadsheetId, [
                {
                    updateCells: {
                        rows: [
                            {
                                values: [
                                    { userEnteredValue: { stringValue: 'version' } },
                                    { userEnteredValue: { stringValue: 'migrated_at' } },
                                ],
                            },
                            {
                                values: [
                                    { userEnteredValue: { numberValue: version } },
                                    { userEnteredValue: { stringValue: new Date().toISOString() } },
                                ],
                            },
                        ],
                        fields: 'userEnteredValue',
                        range: {
                            sheetId: migrationsSheetId,
                            startRowIndex: 0,
                            startColumnIndex: 0,
                        },
                    },
                },
            ]);
        } catch (e: any) {
             // Ignore if it already exists or if adding fails because it exists
        }
        await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
    }

    public async repairFile(spreadsheetId: string, expectedLastModified?: string): Promise<void> {
        const health = await this.checkHealth(spreadsheetId);
        if (health.status === ValidationStatus.INCOMPATIBLE) {
            throw new SchemaIncompatibleError("Cannot repair spreadsheet: the schema is from a newer version of Quozen.");
        }
        if (health.status === ValidationStatus.UPGRADE_REQUIRED) {
            return this.migrateFile(spreadsheetId, expectedLastModified);
        }

        if (expectedLastModified) {
            const res = await this.client.getFileAppProperties(spreadsheetId) as any;
            const currentModified = res.modifiedTime ? new Date(res.modifiedTime).getTime() : 0;
            const expectedModified = new Date(expectedLastModified).getTime();
            if (currentModified > 0 && expectedModified > 0 && currentModified > expectedModified) {
                throw new ConflictError("Spreadsheet has been modified since it was last fetched.");
            }
        }

        try {
            await this.createBackup(spreadsheetId);
        } catch {
            // Proceed if backup is unsupported in mock environment
        }

        const metadata = await this.client.getSpreadsheet(spreadsheetId);
        const sheets = metadata.sheets || [];

        // If Categories tab is missing, initialize it
        if (!sheets.some((s: any) => s.properties?.title === "Categories")) {
            await ensureCategoriesTab(this.client, spreadsheetId);
        }

        const tabsToFetch: string[] = QuozenSchema.tabs
            .filter((t: any) => (sheets as any[]).some((s: any) => s.properties?.title === t.name))
            .map((t: any) => t.name as string);

        if (tabsToFetch.length === 0) return;

        const ranges = tabsToFetch.map(name => `${name}!1:1`);
        const batchGetResult = await this.client.batchGet(spreadsheetId, ranges);
        const valueRanges = batchGetResult.valueRanges || [];

        const requests: any[] = [];

        for (let i = 0; i < tabsToFetch.length; i++) {
            const tabName = tabsToFetch[i];
            const tabSchema = QuozenSchema.tabs.find((t: any) => t.name === tabName);
            if (!tabSchema) continue;

            const sheetId = sheets.find((s: any) => s.properties?.title === tabName)?.properties?.sheetId;
            if (sheetId === undefined) continue;

            const valueRange = valueRanges[i];
            const rows = valueRange?.values || [];
            const headers = rows[0] || [];
            const headerSet = new Set(headers.map((h: any) => String(h).trim()));

            const missingColumns = tabSchema.columns.filter((c: any) => !headerSet.has(c.name));

            if (missingColumns.length > 0) {
                requests.push({
                    appendDimension: {
                        sheetId,
                        dimension: 'COLUMNS',
                        length: missingColumns.length,
                    },
                });

                requests.push({
                    updateCells: {
                        rows: [{ values: missingColumns.map((col: any) => ({ userEnteredValue: { stringValue: col.name } })) }],
                        fields: 'userEnteredValue',
                        range: {
                            sheetId,
                            startRowIndex: 0,
                            endRowIndex: 1,
                            startColumnIndex: headers.length,
                            endColumnIndex: headers.length + missingColumns.length,
                        },
                    },
                });
            }
        }

        if (requests.length > 0) {
            await this.client.batchUpdate(spreadsheetId, requests);
        }

        await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
    }

    public async migrateFile(spreadsheetId: string, expectedLastModified?: string): Promise<void> {
        const health = await this.checkHealth(spreadsheetId);
        if (health.status === ValidationStatus.INCOMPATIBLE) {
            throw new SchemaIncompatibleError("Cannot migrate spreadsheet: the schema is from a newer version of Quozen.");
        }

        if (expectedLastModified) {
            const res = await this.client.getFileAppProperties(spreadsheetId) as any;
            const currentModified = res.modifiedTime ? new Date(res.modifiedTime).getTime() : 0;
            const expectedModified = new Date(expectedLastModified).getTime();
            if (currentModified > 0 && expectedModified > 0 && currentModified > expectedModified) {
                throw new ConflictError("Spreadsheet has been modified since it was last fetched.");
            }
        }

        await this.migrationManager.runMigrations(spreadsheetId, migrations);
        await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
    }

    public async updateFileMetadata(spreadsheetId: string, status: ValidationStatus): Promise<void> {
        const properties = {
            quozen_validation_status: status,
            quozen_validation_time: new Date().toISOString(),
            quozen_schema_version: QuozenSchema.version.toString(),
            // Ensure quozen_type and version for general compat
            quozen_type: "group",
            version: "1.0",
        };
        await this.client.updateFileAppProperties(spreadsheetId, properties);
    }
}
