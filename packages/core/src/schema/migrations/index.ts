import { Migration } from "@qozara/gdocs-schema";
import { migration_2 } from "./2_add_categories";
import { migration_3 } from "./3_add_meta_tab";

// Register all migrations here.
// They will be run sequentially by the MigrationManager.
export const migrations: Migration[] = [
    migration_2,
    migration_3
];
