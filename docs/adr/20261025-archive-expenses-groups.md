# 20261025 - Archive / Unarchive Expenses Groups

## Context
As users participate in multiple expense groups over time, many groups become obsolete, settled, or dormant. Previously, users could only remove groups from their active list by "exiting" or "deleting" the group:
1. **Ownership & Balance Domain Constraints**: `leaveGroup` and `deleteGroup` enforce strict domain rules (ownership validation, non-empty expenses, outstanding balance reconciliation). When a user does not manage an account directly or simply wants to declutter their UI, these operations blocked them from cleaning up their view.
2. **Performance & Network Overhead**: Opening the app on a device with dozens of historical groups would attempt auto-syncing, reading metadata, or checking health across every backing Google Sheet, impacting startup performance and network efficiency.
3. **External File Deletions**: Users sometimes move spreadsheet files to Google Drive trash or delete them permanently outside of Quozen, leaving dangling entries in local caches.

## Decision

1. **Archive / Unarchive Feature (Closing Issue #25)**:
   - Users can archive any expenses group (owners, members, or users not managing an account) without requiring ownership permissions or balance checks.
   - Archiving moves the group out of the active groups list (`UserSettings.groupCache`) and places it into `UserSettings.archivedGroupCache`.
   - Groups page features an **Active Groups (N)** and **Archived Groups (M)** tabbed view.
   - Archived groups are marked with an `Archived (Read-Only)` badge and provide a one-click **Unarchive** action to restore them back to the active list.

2. **Read-Only Enforcement**:
   - Archived groups cannot be modified while archived.
   - At the domain layer, `LedgerService` checks archive status via `checkIsArchived` and throws an error on write attempts (`addExpense`, `updateExpense`, `deleteExpense`, `addSettlement`, etc.).
   - In the web application UI, banner alerts indicate read-only status and creation triggers (such as the Add Expense floating action button) are disabled.

3. **Strict Lazy Evaluation (0 Remote Requests for Archived Groups)**:
   - Archived groups are excluded from app startup processing, auto-sync polling loops, and drive reconcile routines.
   - The Archived Groups view is rendered purely from lightweight metadata preserved in local RxDB (`archivedGroupCache`).
   - Zero Google Drive or Google Sheets network calls are issued for archived groups, guaranteeing high performance even with hundreds of archived groups.

4. **Self-Healing Trashed / Deleted Google Drive Files**:
   - When a group backing file is trashed (`trashed: true`) or deleted (`404` / `NotFoundError` in Google Drive), the app detects it via `checkFileHealth`.
   - The user is alerted with a non-blocking toast notification (`GroupFileUnavailableError`), and the missing group is automatically pruned from `groupCache` and `archivedGroupCache` in both memory and RxDB persistence.

5. **Schema Evolution & Migration (v1 -> v2)**:
   - Bumped RxDB `userSettingsSchema.version` to **2** and registered `userSettingsMigrationStrategies[2]`.
   - Preserved strategy 1 (PR #72) to allow seamless multi-version chained migrations (`v0 -> v1 -> v2`).
   - Added JIT migration `migrateSettingsToV2` in `GroupRepository` for remote `quozen-settings.json` loaded from Google Drive or cloud sync.

6. **Non-Blocking UI & Optimistic Updates**:
   - Archive and unarchive actions execute optimistically via TanStack React Query (`useSettings` mutations), moving cards between tabs in milliseconds without full-screen spinners.
   - Synchronization with local RxDB and background cloud sync proceeds asynchronously in the background.

## Consequences
- Clean, clutter-free user experience without compromising underlying spreadsheet data in Google Drive.
- Startup performance remains fast and unburdened regardless of how many historical groups a user archives.
- Self-healing resilience against out-of-band Drive deletions without broken state or app crashes.
- Seamless backward compatibility for returning devices with earlier schema versions.
