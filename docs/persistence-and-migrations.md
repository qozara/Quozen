# 💾 Quozen Persistence, Versioning & Dual Migration Architecture

This document provides a comprehensive technical guide to Quozen's persistence layer, the three-tier version tracking system, and the two independent schema migration frameworks running in the application.

---

## 🏛️ System Overview

Quozen follows a **Local-First, Bring Your Own Storage (BYOS)** architecture. Unlike typical client-server applications backed by a single centralized relational database, Quozen data lives across two completely decoupled persistence boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            QUOZEN APPLICATION                               │
│                                                                             │
│  ┌─────────────────────────────┐           ┌─────────────────────────────┐  │
│  │   LOCAL PERSISTENCE LAYER   │           │   REMOTE PERSISTENCE LAYER  │  │
│  │  • RxDB on IndexedDB        │           │  • Google Sheets (Tabular)  │  │
│  │  • Pure offline operation   │◄─────────►│  • Google Drive appData     │  │
│  │  • Instant 0ms reactivity   │   Sync    │    (JSON Blob settings)     │  │
│  │  • RxDB Migration Engine    │  Adapter  │  • Future Box / OneDrive    │  │
│  │    (Tier 2)                 │           │  • @qozara/gdocs-schema     │  │
│  │                             │           │    (Tier 3)                 │  │
│  └─────────────────────────────┘           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

Because both environments have distinct storage paradigms (document collections in IndexedDB vs flat rows in spreadsheets and JSON blobs) and independent operational lifecycles:
1. **Quozen runs two distinct schema migration frameworks** (RxDB local migration strategies and `@qozara/gdocs-schema`).
2. **Quozen tracks three separate version artifacts** (Application version, Local RxDB version, Cloud store version).

---

## 🔢 The Three-Tier Version Tracking Model

| Version Tier | Target / Artifact | Where Tracked | How It Is Updated | Can Run Offline? |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: App Version** | Codebase release bundle | `package.json` SemVer + Git commit SHA | Automated during build / release tagging | N/A (code artifact) |
| **Tier 2: Local DB Version** | Local RxDB collections in IndexedDB | RxDB internal metadata + `localStorage['rxdb_schema_hashes']` | Incremented in `packages/core/src/db/schemas/` with an RxDB migration strategy | **Yes (100% offline)** |
| **Tier 3: Cloud Store Version** | Remote user-owned cloud files | Google Drive `appProperties.quozen_schema_version` + `_migrations` spreadsheet tab | Incremented via `@qozara/gdocs-schema` migrations when running `repairFile()` / `migrateFile()` | No (requires cloud connectivity) |

---

## 📁 Storage Routing: Composite Multi-Format Cloud Sync Strategy

Quozen divides remote persistence into two drivers according to natural domain boundaries:

```
                      ┌──────────────────────────────────────────────┐
                      │            RxDB Database Layer               │
                      │  Collections:                                │
                      │  • user_settings                             │
                      │  • expenses (tagged with groupId)            │
                      │  • settlements (tagged with groupId)         │
                      │  • members (tagged with groupId)             │
                      └──────────────────────┬───────────────────────┘
                                             │ SyncDeltaPayload
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │         CompositeCloudSyncProvider           │
                      └──────────────┬────────────────┬──────────────┘
                                     │                │
                       Collection    │                │ Collections:
                      user_settings  │                │ expenses, settlements,
                                     ▼                │ members (per active groupId)
                      ┌─────────────────────┐         ▼
                      │  BlobStorageDriver  │ ┌────────────────────────┐
                      └──────────┬──────────┘ │  TabularStorageDriver  │
                                 │            └───────────┬────────────┘
                   Google Drive  │                        │ Google Sheets
                  appDataFolder  │                        │ (Individual Group Spreadsheets)
                                 ▼                        ▼
                      quozen-settings.json    ┌─────────────────────────────────┐
                      (Private to User)       │ Quozen: Trip to Tokyo (GroupId) │
                                              │  ├── Expenses                   │ (Shareable via
                                              │  ├── Settlements                │  Drive Permissions)
                                              │  └── Members                    │
                                              ├─────────────────────────────────┤
                                              │ Quozen: Roommates (GroupId)     │
                                              │  ├── Expenses                   │
                                              │  ├── Settlements                │
                                              │  └── Members                    │
                                              └─────────────────────────────────┘
```

1. **`BlobStorageDriver` (`spaces=appDataFolder`)**:
   - Manages internal, private user configuration (`user_settings`).
   - Stored in the hidden `appDataFolder` of Google Drive as `quozen-settings.json`.
   - Stores `groupCache[]`, including the optional per-group `accountId` binding that maps a logged-in **User** to a **Personal Account**, **Shared Account**, or **Offline Account** in that group without requiring any Google Sheets or RxDB schema migrations.
   - *Legacy Migration*: Automatically reads any legacy root `quozen-settings.json`, imports it into `appDataFolder`, and cleans up the root file.
2. **`TabularStorageDriver` (Group Spreadsheets in User Drive)**:
   - Manages shared collaborative ledgers (`Expenses`, `Settlements`, `Members` tabs).
   - Rows in the `Members` tab represent ledger **Accounts** (Personal, Shared, or Offline). When a user links to an existing `accountId` via `UserSettings.groupCache[].accountId`, JIT email-to-Google-ID row migration (`migrateUser`) is bypassed so shared account IDs remain stable across all co-managing users.
   - Each group exists as a discrete Google Spreadsheet in the user's primary Drive.
   - Preserves Google Drive permissions, collaborator access, and magic link sharing.

---

## 🛡️ Backward Compatibility & Existing Google Sheets Groups

Users have existing groups stored as Google Sheets in their Google Drive created under Schema Version 1. **We guarantee zero data loss and 100% backward compatibility:**

1. **Dynamic Header Mapping**:
   - Deserialization does not rely on fixed row indices (`row[0]`, `row[3]`).
   - Dynamically searches normalized header strings (`id`, `date`, `amount`, `paidBy`, `splits`, `meta`, etc.).
   - Resilient against manual column reordering in Google Sheets.
2. **Fallback Parsing for Legacy Rows**:
   - Legacy rows lack dedicated `updatedAt` and `deletedAt` columns.
   - `updatedAt` is inferred from `meta.lastModified` -> `date` -> `createdAt` -> `epoch (1970)`.
   - `deletedAt` defaults to `null` (active record).
3. **Automated Safety Backups**:
   - Before executing remote migrations or column repairs on a Google Sheet, `client.createBackup()` creates an automated duplicate named `Backup of <SpreadsheetTitle> - <timestamp>`.
4. **Non-Destructive Column Additions**:
   - When upgrading sheets from Schema v1 to v2 (to add `updatedAt` and `deletedAt`), columns are appended to the end of the sheet via `appendDimension` and `updateCells`. Existing rows and user formulas are preserved untouched.

---

## 👨‍💻 Developer Guide: How to Evolve Schemas

When adding a new field to Quozen entities (e.g. adding `currency` to expenses):

### Step 1: Update Domain Models
Update `packages/core/src/domain/models.ts` and `dtos.ts` with the new field.

### Step 2: Define Tier 2 Local RxDB Migration
1. Open `packages/core/src/db/schemas/expenseSchema.ts`.
2. Increment `version` (e.g. from `0` to `1`).
3. Add the property to `properties`.
4. Define the migration function under `migrationStrategies`:
   ```typescript
   migrationStrategies: {
       1: (oldDoc: any) => {
           oldDoc.currency = oldDoc.currency || 'USD';
           return oldDoc;
       }
   }
   ```

### Step 3: Define Tier 3 Google Sheets Migration
1. Open `packages/core/src/schema/SchemaDefinition.ts`.
2. Increment `version` (e.g. from `1` to `2`).
3. Add the column to the appropriate tab in `QuozenSchema`.
4. Add a migration in `packages/core/src/schema/migrations/` using `@qozara/gdocs-schema`.
