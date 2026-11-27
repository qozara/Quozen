import {
    MANIFEST_KEYS,
    QOZARA_MANIFEST_VERSION,
    type SchemaMigration,
    type TabularMigrationContext,
} from "@qozara/cloud-sync";
import {
    GoogleSheetsContainerDriver,
    GoogleSheetsFetchClient,
} from "@qozara/cloud-sync-google";
import { QuozenSchema, getQuozenSchemaHash } from "../SchemaDefinition";

const META_PROTECT_WARNING = "Qozara System Manifest - Do not delete or alter.";

export const migration_5: SchemaMigration = {
    version: 5,
    up: async (
        client: GoogleSheetsFetchClient,
        spreadsheetId: string,
        context?: TabularMigrationContext
    ) => {
        const schemaHash = await getQuozenSchemaHash();
        const entries: Record<string, string> = {
            [MANIFEST_KEYS.MANIFEST_VERSION]: QOZARA_MANIFEST_VERSION,
            [MANIFEST_KEYS.APP_ID]: "quozen",
            [MANIFEST_KEYS.DOC_TYPE]: "group",
            [MANIFEST_KEYS.SCHEMA_VERSION]: String(QuozenSchema.version),
            [MANIFEST_KEYS.SCHEMA_HASH]: schemaHash,
            [MANIFEST_KEYS.ORIGIN_CONTAINER_ID]: spreadsheetId,
        };

        if (context) {
            await context.ensureTable({
                name: "_meta",
                headers: ["key", "value", "updatedAt"],
                hidden: true,
                protectWarning: META_PROTECT_WARNING,
                frozenHeaderRow: true,
            });
            await context.writeMeta(entries, {
                hidden: true,
                protectWarning: META_PROTECT_WARNING,
            });
            return;
        }

        const driver = new GoogleSheetsContainerDriver(client);
        await driver.ensureTable(spreadsheetId, {
            name: "_meta",
            headers: ["key", "value", "updatedAt"],
            hidden: true,
            protectWarning: META_PROTECT_WARNING,
            frozenHeaderRow: true,
        });
        await driver.writeMeta(spreadsheetId, entries, {
            hidden: true,
            protectWarning: META_PROTECT_WARNING,
        });
    },
};
