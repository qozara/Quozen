import { Migration } from "@qozara/gdocs-schema";
import { migration_2 } from "./2_add_categories";

// Register all migrations here.
// They will be run sequentially by the MigrationManager.
export const migrations: Migration[] = [
    migration_2
];
