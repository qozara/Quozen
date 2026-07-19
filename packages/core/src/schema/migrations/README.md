# Schema Migrations

This document explains how to create a new migration function whenever the schema is modified in the Quozen core.

## Overview

The Quozen schema validation and migration system allows us to safely update the structure of user-owned Google Sheets documents (expense groups) to newer versions. Quozen inspects the GDoc file and identifies its current schema version. If it detects a known outdated schema version, it can sequentially apply transformations (migrations) to reach the most up-to-date version.

## How to Create a New Migration

1. **Update the Schema Version**
   When making changes to the schema structure, first increment the version number in `packages/core/src/schema/SchemaDefinition.ts`.
   ```typescript
   export const QuozenSchema = {
       version: 2, // Incremented from 1
       // ...
   };
   ```

2. **Create the Migration Function**
   Add a new migration object to the `migrations` array inside `packages/core/src/schema/migrations/index.ts`.
   A migration object requires the following structure:
   - `version`: The target version this migration upgrades to.
   - `up`: An async function that takes the `client` and `spreadsheetId` and applies the changes needed to upgrade to this version.
   - `down`: An async function to rollback the changes (currently used for rollbacks if an error occurs).

   **Example:**
   ```typescript
   import { Migration } from "@qozara/gdocs-schema";

   export const migrations: Migration[] = [
       {
           version: 2,
           up: async (client, spreadsheetId) => {
               // Add a new column to the "Expenses" tab
               await client.batchUpdate(spreadsheetId, [
                   {
                       appendDimension: {
                           sheetId: 0, // You will need to resolve the exact sheetId from metadata
                           dimension: "COLUMNS",
                           length: 1
                       }
                   }
               ]);
           },
           down: async (client, spreadsheetId) => {
               // Optional: Revert changes
           }
       }
   ];
   ```

3. **Verify and Test**
   Make sure you run unit tests and manually test the CLI command `quozen repair <groupId>` on a test Google Sheet to ensure your migration applies successfully.
