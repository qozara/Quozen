# Architecture Decision Record: Local-First Persistence Layer with RxDB and Composite BYOS Cloud Sync

## Status
Accepted

## Context
Quozen originally operated on a synchronous, remote-dependent persistence model where every ledger operation read and wrote directly to Google Sheets via `IStorageLayer`. This architectural model introduced critical limitations:
1. **Network Latency & Blocking UI**: CRUD operations suffered from HTTP latency, requiring loading states and spinners for basic ledger edits.
2. **Offline Fragility**: The application could not function without an active internet connection, limiting mobile and intermittent-connectivity usage.
3. **Storage Coupling & Leaky Abstractions**: `IStorageLayer` combined file management (`listFiles`, `createPermission`) with tabular sheet mutations (`batchGetValues`, `batchUpdateValues`), hindering the ability to introduce alternative storage backends (BYOB).
4. **Existing Google Groups Preservation**: Users have existing groups stored as Google Sheets in their Google Drive. Any upgrade must guarantee 100% backward compatibility with these existing files without data loss or corruption.
5. **Private vs. Shared Data Boundaries**: User settings and group directories are private to each user and should reside in tamper-resistant application storage (`appDataFolder`), whereas group ledgers (expenses, settlements, members) are shared documents with multi-user permissions in Google Drive.

## Decisions

### 1. RxDB as Local Single Source of Truth
We adopt **RxDB** (backed by IndexedDB via Dexie) as the core client database for `@quozen/core`:
- A single local RxDB database maintains all application data across all groups.
- `LedgerRepository` reads and writes strictly and exclusively to local RxDB collections (`expenses`, `settlements`, `members` partitioned by `groupId`).
- User actions experience **0ms latency** with immediate local persistence.
- React queries and hooks subscribe directly to RxDB observable queries.

### 2. Composite Cloud Sync Pattern (The Quomida Storage Strategy Pattern)
Following the architecture proven in Quomida (ADR 0010), we introduce `CompositeCloudSyncProvider` with abstract storage drivers and declarative collection routing:
- **`BlobStorageDriver` (Private Application Storage)**:
  - Routes `user_settings` (user profile, preferences, active group, and group directory) to Google Drive `spaces=appDataFolder` as `quozen-settings.json`.
  - Seamlessly migrates legacy root `quozen-settings.json` files to `appDataFolder` upon discovery.
- **`TabularStorageDriver` (Collaborative Document Storage)**:
  - Routes `expenses`, `settlements`, and `members` belonging to each group to its specific Google Spreadsheet in user Drive (e.g. `Quozen: Trip to Tokyo`).
  - Preserves Google Drive native file permissions, sharing links, and user ownership.

### 3. Dual-Layer Migration Engines & Three-Tier Version Tracking (Quomida ADR 0013)
We track versioning and execute migrations across three explicitly decoupled tiers:
- **Tier 1 (Application Version)**: SemVer release in code (`package.json`) combined with Git commit SHA.
- **Tier 2 (Local RxDB Schema Version)**: Defined per collection in `packages/core/src/db/schemas/`. Upgrades execute synchronously and 100% offline on client boot via native RxDB `migrationStrategies`.
- **Tier 3 (Cloud Store Version)**: Tracked in Google Drive metadata (`appProperties.quozen_schema_version`) and a hidden `_migrations` tab in each spreadsheet. Managed via `@qozara/gdocs-schema`.

### 4. Backward Compatibility & Existing Google Sheets Groups
To guarantee that existing Google Drive groups continue working without issue:
- **Dynamic Header Mapping**: Row deserialization dynamically normalizes header labels and matches column names instead of assuming fixed array indices.
- **Fallback Parsing for Legacy Rows**: Existing spreadsheets (Schema v1) lack `updatedAt` and `deletedAt`. Deserializers gracefully infer `updatedAt` from `meta.lastModified`, `date`, or `createdAt`, and default `deletedAt` to `null`.
- **Automated Safety Backups**: Before any remote migration or column repair is applied, `client.createBackup()` creates a full Google Drive copy (`Backup of <SpreadsheetTitle> - <timestamp>`).
- **Non-Destructive Column Repairs**: Missing columns (e.g., adding `updatedAt` or `deletedAt`) are appended to the end of the remote sheet without altering existing rows or formulas.

### 5. Soft Deletes & Last-Write-Wins (LWW) Replication
- All core domain entities (`Expense`, `Settlement`, `Member`) include `updatedAt: Date` and `deletedAt?: Date`.
- Deletions are treated as soft deletes so that offline peers replicate removals reliably.
- RxDB Custom Replication coordinates two-way synchronization with `CompositeCloudSyncProvider`, resolving concurrent edits via Last-Write-Wins based on `updatedAt`.

### 6. Multi-Runtime Storage Strategy
- **Browser (`apps/webapp`)**: Configures `getRxStorageDexie()` (Dexie / IndexedDB) for persistent offline storage.
- **Edge API (`apps/api`), Node CLI (`apps/cli`), and Vitest Unit Tests**: Configures `getRxStorageMemory()` for ultra-fast, stateless in-memory execution without DOM dependencies.

## Consequences

### Positive
- **Instant UI**: 0ms latency on all ledger interactions with immediate optimistic feedback.
- **Full Offline Capability**: Seamless reading and writing offline, synchronizing automatically when connectivity returns.
- **Data Sovereignty & Existing Group Preservation**: All existing Google Sheets groups remain fully functional and shareable via Google Drive.
- **Private Data Isolation**: User settings are securely isolated in `appDataFolder`, avoiding clutter in the user's primary Drive.
- **Zero Silent Corruption**: Dynamic header mapping and automated safety backups ensure user modifications in Google Sheets never destroy data.

### Negative & Mitigations
- **Dual Migration Maintenance**: Adding a new domain field requires defining both an RxDB migration strategy and a Google Sheets column update. *Mitigation: Automated build-time validation script checks schema alignment.*
- **Bundle Size**: Adding `rxdb` and `rxjs`. *Mitigation: Code-split RxDB and use modular storage plugins.*

## Relationship to Past ADRs
- **Amends ADR 20260210 (Smart Sync / Auto Polling)**: Retires interval Drive file polling and form-editing pauses in favor of RxDB continuous/interval replication observables.
- **Amends ADR 20260220 (Serverless State Persistence)**: Migrates `quozen-settings.json` from root Drive to Google Drive `appDataFolder` via `BlobStorageDriver`.
- **Amends ADR 20260224 (DDD for Core Logic)**: Encapsulates `SheetDataMapper` and row-index management entirely inside `TabularStorageDriver`.
- **Amends ADR 20260718 (Schema Validation & UI Remediation)**: Enhances validation with automated safety backups (`createBackup()`) and non-blocking local reads.
