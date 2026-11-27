# 20261126 - Close & Re-open Expense Groups (Domain State Pattern)

## Status
Accepted

## Context
Quozen already supports **Archiving** groups (ADR `20261025`), which is a *per-user, private* UI decluttering mechanism stored in each user's private `quozen-settings.json` (`archivedGroupCache`). However, collaborative groups frequently reach natural completion (e.g., after a trip or event is settled) where *all* members need the group to become read-only so accidental edits are prevented while preserving clean browsing of historical expenses and transfers.

## Decision

1. **Shared Group Property (`GroupStatus = "open" | "closed"`)**:
   - Unlike per-user archiving, `status` is a first-class property of the group itself, persisted in the shared spreadsheet's `_meta` tab (`status`, `closed_at`, `closed_by`) with **zero Google Sheets schema migration** (reuses `QuozenSchema` v3 `_meta`).
   - Any group member (owner or regular member) may close or re-open a group. Closing is fully reversible via `reopenGroup`.

2. **Centralized State Pattern (`GroupLifecycleState`)**:
   - Implemented `IGroupLifecycleState` (`OpenGroupState`, `ClosedGroupState`, `resolveGroupState`) in `@quozen/core/src/domain/GroupState.ts` along with typed errors `GroupClosedError` and `GroupNotSettledError`.
   - `LedgerService`, `GroupRepository`, `CommandDraftService`, Edge REST API routes, CLI interactive menus, and WebApp views all delegate capability and transition assertions to `GroupLifecycleState`:
     - When `closed`: rejects expense/settlement CRUD, `CommandDraftService.createDraft`, `renameMember`, `removeUnusedMember`, `updateGroup`, and new-member `joinGroup` with `GroupClosedError`. Read-only perspective account switching, sharing, archiving, leaving, and owner deletion remain permitted.
     - Transitioning `open -> closed` enforces `areAllBalancesZero()` unless `{ force: true }` is explicitly confirmed.

3. **Offline-Capable Local-First Sync (`userSettingsSchema` v4 → v5)**:
   - Bumped RxDB `userSettingsSchema` to `version: 5` (with `userSettingsMigrationStrategies[5]`), adding `status`, `statusUpdatedAt`, and `pendingStatusSync` to `CachedGroup`.
   - Closing or re-opening while offline updates RxDB immediately (`0ms`) and sets `pendingStatusSync = true`, which `CompositeCloudSyncProvider` flushes to `_meta!status` on reconnect using Last-Write-Wins (`UserSettingsMerger`). Remote `_meta!status` updates from collaborators are pulled into local settings during sync reconciliation.

4. **Auto-Close Prompt & Clean View-Only UI**:
   - `Ledger.wouldSettlementZeroAllBalances(...)` detects when a transfer zeroes all member balances and prompts the user (WebApp `AlertDialog` and CLI interactive prompt) to close the group.
   - In the WebApp, closed groups remain in the Active Groups list with a subtle `Closed` badge and `Closed` header pill (no warning banner). All CRUD controls (`+` nav button, `Zap` command parser trigger, Settle Up buttons, item meatball menus) are removed; tapping an expense or transfer opens a clean read-only `TransactionDetailDrawer`.

5. **Edge REST API & CLI Parity**:
   - Added `POST /api/v1/groups/{id}/close` (`{ force?: boolean }`) and `POST /api/v1/groups/{id}/reopen`, exposing `status` in `GroupSchema` and `LedgerAnalyticsSchema` and returning `409 Conflict` for `GroupClosedError` / `GroupNotSettledError`.
   - Added `quozen close <groupId> [--force]`, `quozen reopen <groupId>`, and state-driven interactive CLI menus.

## Consequences
- Single source of truth for group lifecycle rules across core SDK, API, CLI, and WebApp.
- Zero breaking changes for existing Google Sheets spreadsheets (missing `_meta!status` defaults to `"open"`).
- Clean, clutter-free read-only navigation for completed groups without sacrificing offline-first responsiveness.
