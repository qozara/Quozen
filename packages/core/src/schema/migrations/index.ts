import { Migration } from "@qozara/gdocs-schema";

// Register all migrations here.
// They will be run sequentially by the MigrationManager.
export const migrations: Migration[] = [
    // Example format for future migrations:
    // {
    //     version: 2,
    //     up: async (client, spreadsheetId) => {
    //         // Run operations to migrate to version 2
    //     },
    //     down: async (client, spreadsheetId) => {
    //         // Rollback operations for version 2
    //     }
    // }
];
