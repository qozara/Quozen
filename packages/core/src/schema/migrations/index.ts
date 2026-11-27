import { type SchemaMigration } from "@qozara/cloud-sync";
import { migration_2 } from "./2_add_categories";
import { migration_3 } from "./3_add_meta_tab";
import { migration_4 } from "./4_add_category_translations";
import { migration_5 } from "./5_stamp_manifest_identity";

// Register all migrations here.
// They will be run sequentially by the MigrationManager.
export const migrations: SchemaMigration[] = [
    migration_2,
    migration_3,
    migration_4,
    migration_5
];
