# Architecture Decision Record: Decoupling Account Identity from Authentication & Isolating Cloud Storage Ports

## Context

In its initial implementation, Quozen was designed under two simplifying assumptions:
1. **1:1 Coupling of Auth Identity and Ledger Rows**: Every participant in a group was represented as a `Member` row where `Member.userId` was expected to match the authenticated Google User ID (`sub`), or a legacy invited email (`invited@example.com`). When a user logged in, an aggressive JIT migration (`migrateUser()`) scanned the ledger and mutated `Member.userId`, `Expenses.paidByUserId`, `Expenses.splits[].userId`, and `Settlements` to match the user's Google ID.
2. **Coupled Cloud Storage & Drive Queries**: `GroupRepository` mixed ledger coordination with raw Google Drive query syntax (e.g. `properties has { key='quozen_type' and value='group' } and trashed = false`) and direct Google Drive permission API calls (`storage.createPermission`, `storage.listPermissions`).

### The Problems Encountered
- **Identity Split-Brain in Co-Managed & Shared Accounts**: When multiple authenticated users co-managed an account (e.g., in a travel group like the Madryn scenario where users C and D both manage account Y), `migrateUser()` would attempt to hijack the shared account's `userId` to the latest logging-in user, breaking balances and leading to unsynced ledger states.
- **Misleading `Members` Tab Semantics**: The `Members` table in Google Sheets and RxDB conflated the concept of an **Accounting Ledger Account** (a balance sheet within the ledger) with an **Authenticated User Identity** (a Google OAuth identity).
- **Leaking Infrastructure Abstractions**: Cloud catalog discovery and Access Control Lists (permissions) were hard-coded to Google Drive semantics within `GroupRepository`, violating the Dependency Inversion Principle and preventing clean BYOB (Bring-Your-Own-Backend) adapters (such as local filesystem, Nextcloud, S3, or Dropbox).

---

## Decision

### 1. Domain Model Evolution: `LedgerAccount` and `managedBy`
- Introduced a semantic domain alias:
  ```ts
  export type LedgerAccount = Member;
  ```
  This establishes the conceptual separation in domain terminology while preserving full backward compatibility across all consumers.
- Added `managedBy?: string[]` to the domain model:
  ```ts
  export interface Member {
      userId: string;
      email?: string;
      name: string;
      role: MemberRole;
      managedBy?: string[];
      joinedAt: Date;
      updatedAt: Date;
  }
  ```
  An account can now be explicitly managed by zero (offline), one (personal), or multiple (shared) user emails.

### 2. `migrateUser()` Deprecation & Safety Guard
- Deprecated mutating account `userId`s on login.
- Guarded `LedgerService.getLedger()` and `GroupRepository.importGroup()`: `migrateUser()` now **only** executes if:
  1. The member row has a legacy email as its `userId` (`currentUserMember.userId === currentUserMember.email`), **and**
  2. The current user is not linked to a different account (`!hasLinkedAccount`).
- Opaque immutable account IDs (such as `acc_<uuid>` or non-email aliases) and co-managed accounts are permanently protected from identity rewriting.

### 3. Single Source of Truth in `Members` with Zero RxDB Schema Changes
- Rather than maintaining fragmented bindings in `_meta!account_managers` or mutating RxDB schema definitions, the comma-separated manager emails are stored directly in `Members!email` in Google Sheets and mapped to `MemberDocType.email` in local RxDB.
- `SheetDataMapper.mapToMember` and `SheetDataMapper.mapFromMember`:
  - Serializes `member.managedBy.join(", ")` into the `email` column.
  - Parses comma-separated emails into `managedBy: string[]`.
- `memberToDoc` and `docToMember`:
  - Translates `managedBy` seamlessly through `MemberDocType.email`.
  - **Zero RxDB schema migration**: Keeps `memberSchema` at `version: 0`, completely avoiding RxDB `DB6` schema modification errors and passing `validate-schemas.js`.
- Automatic healing: Legacy `_meta!account_managers` entries are lazily ingested into `Member.managedBy` and written to both RxDB and remote sheets when encountered.

### 4. Decoupling Cloud Storage & Access Control Ports
Introduced two cloud-agnostic port interfaces in `packages/core/src/sync/types.ts`:
- **`CloudGroupCatalogDriver`**:
  ```ts
  export interface CloudGroupCatalogDriver {
      id: string;
      name: string;
      listGroupContainers(): Promise<CloudContainerMetadata[]>;
      getGroupContainer(groupId: string): Promise<CloudContainerMetadata | null>;
      createGroupContainer(title: string, sheetTitles: string[], properties?: Record<string, string>): Promise<string>;
      updateGroupContainer(groupId: string, metadata: { name?: string; properties?: Record<string, string> }): Promise<void>;
      deleteGroupContainer(groupId: string): Promise<void>;
      checkContainerHealth(groupId: string): Promise<{ available: boolean; reason?: "trashed" | "deleted" }>;
  }
  ```
- **`CloudAccessControlDriver`**:
  ```ts
  export interface CloudAccessControlDriver {
      id: string;
      name: string;
      listCollaborators(groupId: string): Promise<GroupCollaborator[]>;
      grantAccess(groupId: string, email: string, role?: "editor" | "viewer"): Promise<{ displayName?: string }>;
      revokeAccess(groupId: string, collaboratorIdOrEmail: string): Promise<void>;
      getAccessMode(groupId: string): Promise<GroupAccessMode>;
      setAccessMode(groupId: string, mode: GroupAccessMode): Promise<void>;
  }
  ```
- Implemented `StorageLayerCatalogAndAclDriver` as the default adapter bridging `IStorageLayer` to these ports.
- Refactored `GroupRepository` to eliminate all raw Google Drive query strings and permission mutations, delegating them cleanly to `catalogDriver` and `aclDriver`.
- Exposed `catalogDriver` and `aclDriver` in `QuozenConfig` and `QuozenClient` constructor, enabling straightforward mocking in unit tests and pluggability for alternative cloud storage providers.

---

## Consequences

### Positive
- **Split-Brain Elimination**: Co-managed shared accounts (such as in the Madryn 4-user scenario) have a single source of truth in `Members!email` / `Member.managedBy` synchronized across all devices without mutating IDs.
- **Portability & Extensibility**: `GroupRepository` is no longer bound to Google Drive's specific query language or permission API. Alternative cloud backends (e.g., Nextcloud, Local Folders, S3) can be implemented simply by satisfying `CloudGroupCatalogDriver` and `CloudAccessControlDriver`.
- **Zero Production Disruption**:
  - Existing Google Sheets (Schema v1/v3) require no structural alterations.
  - Existing RxDB local databases require no schema migration, avoiding data loss or `DB6` runtime errors.
  - 99% default use-case (1 User = 1 Personal Account) remains lightweight and completely unimpacted.

### Considerations
- `Members!email` stores comma-separated strings when an account is co-managed (e.g., `user1@example.com, user2@example.com`). Any external tools reading the raw sheet should treat this field as a manager list rather than a single email.
