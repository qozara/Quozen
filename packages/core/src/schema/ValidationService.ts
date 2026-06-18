import {
    SchemaValidator,
    MigrationManager,
    GoogleSheetsFetchClient,
} from "@qozara/gdocs-schema";
import { QuozenSchema } from "./SchemaDefinition";
import { migrations } from "./migrations/index";

export enum ValidationStatus {
    UP_TO_DATE = "UP_TO_DATE",
    UPDATABLE = "UPDATABLE",
    OUT_OF_SYNC = "OUT_OF_SYNC",
}

export class ValidationService {
    private client: GoogleSheetsFetchClient;
    private validator: SchemaValidator;
    private migrationManager: MigrationManager;

    constructor(getToken: () => string | null) {
        const token = getToken();
        if (!token) throw new Error("ValidationService requires a valid Google access token.");
        
        this.client = new GoogleSheetsFetchClient({ accessToken: token });
        this.validator = new SchemaValidator(this.client);
        this.migrationManager = new MigrationManager(this.client);
    }

    public async inspectFile(spreadsheetId: string): Promise<ValidationStatus> {
        const result = await this.validator.validateStructure(spreadsheetId, QuozenSchema);
        if (result.valid) {
            return ValidationStatus.UP_TO_DATE;
        }

        // If not valid, check if it has a known version we can migrate from.
        try {
            const { appProperties } = await this.client.getFileAppProperties(spreadsheetId);
            const currentVersion = parseInt(appProperties?.quozen_schema_version || "0", 10);
            
            // If it has a known version less than our target schema, it's updatable.
            if (currentVersion > 0 && currentVersion < QuozenSchema.version) {
                return ValidationStatus.UPDATABLE;
            }
        } catch (e) {
            // Ignore error
        }

        return ValidationStatus.OUT_OF_SYNC;
    }

    public async initializeFile(spreadsheetId: string): Promise<void> {
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
                                    { userEnteredValue: { numberValue: QuozenSchema.version } },
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
        await this.updateFileMetadata(spreadsheetId, ValidationStatus.UP_TO_DATE);
    }

    public async repairFile(spreadsheetId: string): Promise<void> {
        const metadata = await this.client.getSpreadsheet(spreadsheetId);
        const sheets = metadata.sheets || [];

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

        await this.updateFileMetadata(spreadsheetId, ValidationStatus.UP_TO_DATE);
    }

    public async migrateFile(spreadsheetId: string): Promise<void> {
        await this.migrationManager.runMigrations(spreadsheetId, migrations);
        await this.updateFileMetadata(spreadsheetId, ValidationStatus.UP_TO_DATE);
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
