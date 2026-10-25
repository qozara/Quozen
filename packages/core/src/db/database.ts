import {
    createRxDatabase,
    removeRxDatabase,
    addRxPlugin,
    prepareQuery,
    type RxDatabase,
    type RxCollection,
    type RxStorage
} from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import {
    userSettingsSchema,
    userSettingsMigrationStrategies,
    expenseSchema,
    expenseMigrationStrategies,
    settlementSchema,
    memberSchema,
    categorySchema,
    type UserSettingsDocType,
    type ExpenseDocType,
    type SettlementDocType,
    type MemberDocType,
    type CategoryDocType
} from "./schemas";

addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBUpdatePlugin);
addRxPlugin(RxDBQueryBuilderPlugin);

export { prepareQuery };

export type QuozenDatabaseCollections = {
    user_settings: RxCollection<UserSettingsDocType>;
    expenses: RxCollection<ExpenseDocType>;
    settlements: RxCollection<SettlementDocType>;
    members: RxCollection<MemberDocType>;
    categories: RxCollection<CategoryDocType>;
};

export type QuozenDatabase = RxDatabase<QuozenDatabaseCollections>;

export interface QuozenDatabaseOptions {
    name?: string;
    storage?: RxStorage<any, any>;
    multiInstance?: boolean;
}

let defaultDbPromise: Promise<QuozenDatabase> | null = null;
let defaultDbInstance: QuozenDatabase | null = null;

export async function createQuozenDatabase(options?: QuozenDatabaseOptions): Promise<QuozenDatabase> {
    const storage = options?.storage || getRxStorageMemory();
    const name = options?.name || "quozendb_v1";

    const db = await createRxDatabase<QuozenDatabaseCollections>({
        name,
        storage,
        multiInstance: options?.multiInstance ?? false
    });

    try {
        await db.addCollections({
            user_settings: {
                schema: userSettingsSchema,
                migrationStrategies: userSettingsMigrationStrategies
            },
            expenses: {
                schema: expenseSchema,
                migrationStrategies: expenseMigrationStrategies
            },
            settlements: {
                schema: settlementSchema
            },
            members: {
                schema: memberSchema
            },
            categories: {
                schema: categorySchema
            }
        });
    } catch (err) {
        try {
            await db.close();
        } catch {
            // Ignore if already closed
        }
        throw err;
    }

    return db;
}

export function getQuozenDatabase(options?: QuozenDatabaseOptions): Promise<QuozenDatabase> {
    if (!defaultDbPromise) {
        defaultDbPromise = createQuozenDatabase(options)
            .then(db => {
                defaultDbInstance = db;
                return db;
            })
            .catch(err => {
                defaultDbPromise = null;
                throw err;
            });
    }
    return defaultDbPromise;
}

export async function destroyQuozenDatabase(db?: QuozenDatabase): Promise<void> {
    const target = db || defaultDbInstance;
    if (target) {
        try {
            await target.close();
        } catch {
            // Ignore if already closed
        }
        if (target === defaultDbInstance) {
            defaultDbInstance = null;
            defaultDbPromise = null;
        }
    }
}

export async function clearQuozenDatabase(options?: QuozenDatabaseOptions): Promise<QuozenDatabase> {
    const storage = options?.storage || getRxStorageMemory();
    const name = options?.name || "quozendb_v1";

    await destroyQuozenDatabase();
    try {
        await removeRxDatabase(name, storage);
    } catch {
        // Ignore removal error if database did not exist
    }
    return getQuozenDatabase(options);
}
