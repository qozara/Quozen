# Persistence Layer & Local-First Architecture Plan (Final Revision)

This document outlines the proposed architecture to overhaul the Quozen persistence layer. The new design shifts from a synchronous, remote-dependent model to a **Local-First, Offline-Capable, Bring-Your-Own-Backend (BYOB)** architecture using RxDB.

Based on recent review, we identified that the current `IStorageLayer` is heavily coupled to Google Sheets (`batchGetValues`, `createSpreadsheet`). To achieve true BYOB without creating useless intermediate abstractions, we must completely refactor the storage interface.

---

## 1. Architectural Paradigm: True Decoupling

We will cleanly split the architecture into three domains: the **Core App (Local-First)**, the **Sync Interface (BYOB)**, and the **Backend Implementations**.

### 1.1 The Core App (RxDB)
The core application will rely entirely on RxDB as its local database. 
- `LedgerRepository` will be refactored to read and write **exclusively** from RxDB.
- **Local Migrations:** RxDB has built-in local migration support. If the app updates to a new schema version while offline, RxDB will execute a local migration function to transform the JSON data. The app remains fully functional offline.

### 1.2 The Sync Interface (`ISyncBackend`)
We will completely delete the existing `IStorageLayer`. It will be replaced by a generic synchronization interface that only speaks in JSON documents.

```typescript
interface ISyncBackend {
    pullChanges(collection: string, since: Timestamp): Promise<JsonDocument[]>;
    pushChanges(collection: string, changes: JsonDocument[]): Promise<void>;
}
```
The core app's replication engine will use this interface to push/pull JSON changes. It will not know anything about Spreadsheets, rows, columns, or Drive permissions.

### 1.3 Unified Migration Strategy
A key goal is to unify migrations while retaining the Google Sheets format. We cannot entirely "get rid" of Quozen's ad-hoc Google Sheets validation, because modifying a local JSON object (RxDB) does not automatically add a column to a remote Google Sheet. However, we can unify the process into a single, cohesive workflow:

1. **Local Data Transformation (RxDB):** RxDB strictly enforces local migrations. When the app schema updates (e.g., adding a new `currency` field), RxDB executes a pure JSON-to-JSON migration function locally. This guarantees that offline users can immediately continue working with the new schema.
2. **Remote Structural Transformation (`ValidationService`):** The `GoogleDriveSyncBackend` adapter will utilize the existing `ValidationService.repairFile()` declaratively. Before pushing new RxDB data to Google Drive, the adapter verifies if the remote sheet has all the necessary columns defined in the new schema. If a column is missing, `repairFile()` automatically appends it via the Sheets API.
3. **Deprecation of Imperative Scripts:** By combining RxDB's local data transformation with `ValidationService`'s declarative auto-repair, we can deprecate the need for imperative, ad-hoc remote migration scripts (e.g., manually writing `up`/`down` scripts in `migrations/index.ts`). 

### 1.4 Backend Implementations & Encapsulation
The logic for dealing with Google Sheets, including mapping and the aforementioned remote structural migrations, will be strictly encapsulated within its specific backend adapter.

**The Google Drive Backend (`GoogleDriveSyncBackend`)**
This class implements `ISyncBackend`. 
- **Mapping:** It internally uses `SheetDataMapper` to convert the JSON documents received from `pushChanges()` into `batchUpdate` requests for Google Sheets.
- **Encapsulation:** By isolating `ValidationService` here, we prevent Google-specific logic from leaking into the core application.

**Custom REST Backend (`CustomRestSyncBackend`)**
A user bringing their own backend simply implements `ISyncBackend` and POSTs/GETs the JSON documents directly to their server. They are responsible for their own server-side database migrations.

---

## 2. Sync Engine & Conflict Resolution
- **Last-Write-Wins (LWW) & Soft Deletes**: All entities will have `updatedAt` and `deletedAt` timestamps. RxDB's replication protocol handles LWW conflict resolution automatically based on the `updatedAt` timestamp when merging remote and local documents.

---

## 3. Implementation Steps

#### Phase 1: Local Database Foundation (RxDB)
- Add `updatedAt` and `deletedAt` to all core models (`Expense`, `Settlement`, `Member`).
- Set up the RxDB database and define the JSON schemas for the collections.
- Define local RxDB migration functions (e.g., v1 -> v2 schema transforms).
- Refactor `LedgerRepository` to perform CRUD operations solely against RxDB (making the UI instantly reactive).

#### Phase 2: Interface Destruction & BYOB Creation
- Delete `IStorageLayer` and replace it with `ISyncBackend`.
- Encapsulate all Google Drive API calls, `ValidationService`, and `SheetDataMapper` inside a new `GoogleDriveSyncBackend` class.

#### Phase 3: RxDB Replication Integration
- Implement the RxDB Custom Replication protocol that binds the RxDB collections to the `ISyncBackend`.
- Configure the Last-Write-Wins merge logic based on `updatedAt`.

#### Phase 4: UI & Context Refactoring
- Update `AutoSyncContext` to monitor RxDB's replication state (e.g., "Syncing", "Offline", "Error").
- Refactor React queries to subscribe directly to RxDB observables, providing 0ms latency for user actions.

---

## 4. Verification Plan

### Automated Tests
- **Adapter Tests:** Verify that `GoogleDriveSyncBackend.pushChanges()` correctly translates a JSON document into a valid `batchUpdate` request that finds the correct row by ID.
- **Sync Logic Tests:** Simulate an offline edit and a simultaneous remote edit. Verify that the RxDB replication and LWW strategy correctly resolve the state.

### Manual Verification
1. **Offline Capability & Migrations:** Disconnect network, add/edit expenses. Simulate an app update that bumps the schema version. Verify local RxDB migrates data and allows continued offline work.
2. **Reconnection Sync:** Reconnect network. Verify pending (and migrated) changes are pushed to Google Drive and the `ValidationService` adds any new required columns to the Google Sheet.
3. **External Edit Detection:** While the app is open, manually edit a row in the Google Sheet. The app should detect the change during its next polling cycle, pull the data, and update the local UI via RxDB observables.
