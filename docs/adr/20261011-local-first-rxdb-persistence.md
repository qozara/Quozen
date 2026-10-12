# Architecture Decision Record: Local-First Persistence Layer with RxDB

## Status
Accepted

## Context
Quozen originally operated on a synchronous, remote-dependent persistence model where every ledger operation read and wrote directly to Google Sheets via `IStorageLayer`. This architectural model introduced critical limitations:
1. **Network Latency & Blocking UI**: CRUD operations suffered from HTTP latency, requiring loading states and spinners for basic ledger edits.
2. **Offline Fragility**: The application could not function without an active internet connection, limiting mobile and intermittent-connectivity usage.
3. **Storage Coupling & Leaky Abstractions**: `IStorageLayer` combined file management (`listFiles`, `createPermission`) with tabular sheet mutations (`batchGetValues`, `batchUpdateValues`), hindering the ability to introduce alternative storage backends (BYOB).
4. **Synchronous Schema Gatekeeping**: Remote schema checks (`ValidationService.checkHealth()`) blocked initial ledger loads whenever network issues arose or columns were outdated.
5. **Auto-Sync Conflicts**: Polling Google Drive metadata required pausing sync during edits to prevent background updates from overwriting active form state.

## Decisions

### 1. RxDB as Local Single Source of Truth
We adopt **RxDB** as the core client database for `@quozen/core`.
- `LedgerRepository` reads and writes strictly and exclusively to local RxDB collections (`expenses`, `settlements`, `members`).
- User actions experience **0ms latency** with immediate local persistence.
- React queries and hooks subscribe directly to RxDB observable queries.

### 2. Interface Separation: `ISyncBackend` vs. `IGroupStorageBackend`
To eliminate storage coupling while preserving group lifecycle features, we separate the legacy `IStorageLayer` into two independent contracts:
- **`ISyncBackend`**: A generic document-replication interface exchanging JSON documents (`pushChanges` / `pullChanges`). Core ledger business logic is completely ignorant of spreadsheet concepts, rows, or cloud APIs.
- **`IGroupStorageBackend`**: A file-management interface used exclusively by `GroupRepository` to handle file creation, group discovery, access permissions, and `quozen-settings.json`.

### 3. Unified Declarative Migration Strategy
We unify data migrations across local and remote stores:
- **Local JSON Migrations**: Executed offline by RxDB schema migration functions. Users can continue working with updated schemas even when offline.
- **Remote Structural Healing**: The `GoogleDriveSyncBackend` adapter declaratively runs `ValidationService.repairFile()` during `pushChanges()` before committing rows. Missing columns are appended automatically via the Sheets API, deprecating imperative manual migration scripts.
- **Non-blocking Reads**: `LedgerService.getLedger()` performs instant local reads without synchronously gating on remote schema status checks.

### 4. Soft Deletes & Last-Write-Wins (LWW) Replication
- All core domain entities (`Expense`, `Settlement`, `Member`) are updated with `updatedAt: Date` and `deletedAt?: Date`.
- Deletions are treated as soft deletes to ensure reliable replication across peers.
- RxDB's replication protocol coordinates push/pull synchronization with the active `ISyncBackend`, resolving concurrent edits via Last-Write-Wins based on `updatedAt`.

### 5. Multi-Runtime Storage Plugins
To accommodate Quozen's multi-package monorepo:
- **Browser (`apps/webapp`)**: Configures `getRxStorageDexie()` (Dexie / IndexedDB) for persistent offline storage.
- **Edge API (`apps/api`) & Node CLI (`apps/cli`) & Tests**: Configures `getRxStorageMemory()` for lightweight, in-memory execution in stateless environments.

### 6. Event-Driven Auto-Sync
- `AutoSyncContext` transitions from timer-based metadata polling to an event-driven status provider listening to RxDB replication observables.
- Route-based sync pauses are retired, as local-first writes and LWW conflict resolution prevent background updates from disrupting user form entry.

## Consequences

### Positive
- **Instant UI**: Instantaneous responsiveness across all ledger interactions.
- **Full Offline Capability**: Seamless reading and writing offline, synchronizing automatically when connectivity returns.
- **True BYOB Portability**: New backends (REST APIs, CouchDB, local file stores) can be integrated by implementing `ISyncBackend` without touching domain logic.
- **Elimination of Schema Regressions**: Declarative remote auto-repair prevents manual migration failures.

### Negative & Mitigations
- **Bundle Size**: Adding `rxdb` and `rxjs` increases bundle size. *Mitigation: Code-split RxDB and rely on tree-shakable modular storage plugins.*
- **Dual Timestamps**: Sheets must now store `updatedAt` and `deletedAt`. *Mitigation: `SheetDataMapper` encapsulates timestamp serialization in the Google Drive adapter.*

## Relationship to Past ADRs
- **Amends ADR 20260210 (Smart Sync / Auto Polling)**: Retires interval Drive file polling and form-editing pauses in favor of RxDB continuous/interval replication observables.
- **Amends ADR 20260224 (DDD for Core Logic)**: Eliminates Google Sheet row mapping from `LedgerRepository`, moving `SheetDataMapper` entirely into `GoogleDriveSyncBackend`.
- **Amends ADR 20260718 (Schema Validation & UI Remediation)**: Eliminates synchronous remote schema blocking on `getLedger()`. Remote validation and auto-repair are handled declaratively by the sync adapter.
