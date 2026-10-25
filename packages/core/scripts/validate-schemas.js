import * as schemas from "../dist/index.js";

const V0_BASELINE = {
    user_settings: {
        version: 0,
        properties: [
            "id",
            "version",
            "activeGroupId",
            "groupCache",
            "preferences",
            "encryptedApiKey",
            "preferencesUpdatedAt",
            "lastUpdated",
            "updatedAt",
            "deletedAt"
        ]
    },
    expenses: {
        version: 0,
        properties: [
            "id",
            "groupId",
            "description",
            "amount",
            "category",
            "date",
            "paidByUserId",
            "splits",
            "createdAt",
            "updatedAt",
            "deletedAt"
        ]
    },
    settlements: {
        version: 0,
        properties: [
            "id",
            "groupId",
            "date",
            "fromUserId",
            "toUserId",
            "amount",
            "method",
            "notes",
            "updatedAt",
            "deletedAt"
        ]
    },
    members: {
        version: 0,
        properties: [
            "id",
            "groupId",
            "userId",
            "email",
            "name",
            "role",
            "joinedAt",
            "updatedAt",
            "deletedAt"
        ]
    },
    categories: {
        version: 0,
        properties: [
            "id",
            "groupId",
            "categoryId",
            "name",
            "icon",
            "description",
            "sortOrder",
            "updatedAt",
            "deletedAt"
        ]
    }
};

const allSchemas = [
    schemas.userSettingsSchema,
    schemas.expenseSchema,
    schemas.settlementSchema,
    schemas.memberSchema,
    schemas.categorySchema
];

console.log("[Schema Validation] Starting build-time RxDB schema checks...");

let hasError = false;

for (const schema of allSchemas) {
    if (!schema) {
        console.error("[Schema Validation] FATAL: Schema export missing from @quozen/core dist.");
        process.exit(1);
    }
    const baseline = V0_BASELINE[schema.title];
    if (!baseline) {
        console.error(`[Schema Validation] FATAL: No V0 baseline registered for schema "${schema.title}".`);
        process.exit(1);
    }

    if (schema.version === 0) {
        const currentProperties = Object.keys(schema.properties).sort();
        const baselineProperties = [...baseline.properties].sort();

        const missingInCurrent = baselineProperties.filter(p => !currentProperties.includes(p));
        const addedWithoutBump = currentProperties.filter(p => !baselineProperties.includes(p));

        if (missingInCurrent.length > 0 || addedWithoutBump.length > 0) {
            console.error(
                `\n[SCHEMA EVOLUTION ERROR] Schema "${schema.title}" version was NOT bumped, but properties were modified!\n` +
                `Added without version bump: ${JSON.stringify(addedWithoutBump)}\n` +
                `Removed without version bump: ${JSON.stringify(missingInCurrent)}\n` +
                `Modifying an existing schema version triggers RxDB Error DB6 (Schema Hash Mismatch) on client databases.\n` +
                `To fix this:\n` +
                `1. Bump "${schema.title}" version to ${schema.version + 1}.\n` +
                `2. Add a migration strategy in packages/core/src/db/database.ts.\n`
            );
            hasError = true;
        }
    } else if (schema.version > 0) {
        if (schema.title === "expenses") {
            const strategies = schemas.expenseMigrationStrategies;
            if (!strategies || typeof strategies[1] !== "function") {
                console.error(`\n[SCHEMA MIGRATION ERROR] Schema "${schema.title}" version is ${schema.version}, but expenseMigrationStrategies[1] is missing or invalid!`);
                hasError = true;
            }
        }
    }
}

if (hasError) {
    console.error("[Schema Validation] Build failed due to schema validation errors.");
    process.exit(1);
} else {
    console.log("[Schema Validation] All RxDB schemas and migrations verified.");
}
