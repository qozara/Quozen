# Architecture Decision Record: Account-User Separation (Personal, Shared, and Offline Accounts)

## Context
Previously, Quozen assumed a strict 1:1 mapping between an authenticated Google **User** (`user.id`) and a ledger participant row in the group spreadsheet's `Members` tab (except for unlinked offline aliases).

However, in many real-world group expense scenarios—such as two couples traveling together, a multi-person family sharing expenses with other households, or subgroups of friends splitting costs as consolidated units—multiple logged-in Google users need to co-manage a single **Shared Account** in a group, or switch to manage an **Offline Account**, without inflating the number of split shares in the ledger or triggering destructive row migrations.

## Decision
1. **Three-Level Domain Taxonomy (`Group` → `Account` → `User`)**:
   - **Group**: The expense group (spreadsheet).
   - **Account**: A financial balance sheet / split share within a group (stored as a row in the `Members` tab and referenced by `Expenses.paidByUserId`, `Expenses.splits[].userId`, and `Settlements`).
     - **Personal Account**: Managed by a single logged-in User (default 1:1 behavior).
     - **Shared Account**: Co-managed by 2 or more logged-in Users (e.g., `"Garcia Family"`, `"The Smiths"`, `"Cabin A"`). It counts as **1 share** in equal expense splits.
     - **Offline Account**: A participant without a linked login, managed on their behalf by any logged-in User in the group.
   - **User**: An authenticated Google identity (`auth.user.id`, `auth.user.email`).
2. **Zero Database & Spreadsheet Schema Migrations**:
   - The Google Sheets schema (`QuozenSchema` v1) and the local RxDB `user_settings` schema (v0) remain unchanged.
   - The user-to-account binding is stored per group in the user's private `quozen-settings.json` (`UserSettings.groupCache[].accountId?: string`). If `accountId` is omitted, it defaults to `user.id`.
3. **Bypassing `migrateUser` for Linked Accounts**:
   - When a user joins a group via `/join/:id` and selects an existing account (`joinGroup(id, { accountId })`) or switches their active account on the Dashboard (`updateGroupAccount(groupId, accountId)`), `GroupRepository` records `accountId` in `groupCache` without appending a duplicate row to `Members` and without running `migrateUser`.
   - `LedgerService` resolves `effectiveAccountId` from `activeAccountId ?? getActiveAccountId() ?? user.id`, authorizing mutations when either the authenticated `user.id` or `effectiveAccountId` is a member of the group, and skipping JIT email-to-Google-ID migration when an explicit `accountId` is linked.
4. **Smart Cleanup & Safe Group Leaving**:
   - If a user initially joined as a Personal Account (with 0 expenses and 0 settlements) and subsequently switches to an existing Shared Account, `LedgerService.removeUnusedMember(userId)` safely removes their unused row from `Members`.
   - When a user co-managing a Shared Account leaves a group (`leaveGroup`), the group is removed from their `groupCache` without deleting the Shared Account row from `Members`.

## Consequences
- Zero schema migrations (`QuozenSchema` v1 and RxDB `userSettingsSchema` v0 are untouched) and 100% backward compatibility with all existing spreadsheets.
- Zero UI clutter for the 90% default case (1 User = 1 Personal Account), while providing a lightweight active account switcher pill on the Dashboard balance card and an optional *"Use an existing account in this group"* selector on `/join/:id`.
