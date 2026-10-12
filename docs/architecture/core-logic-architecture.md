# Core Logic Architecture

## Request Execution Flow (Local-First Paradigm)

Below is the workflow of adding data (e.g., an Expense) using the local-first `@quozen/core` `QuozenClient`. 

Operations resolve with **0ms latency** against the local database, while replication and cloud structural validation occur asynchronously in the background.

```mermaid
sequenceDiagram
    autonumber
    participant Client as App / REST API
    participant SDK as QuozenClient
    participant Ledger as LedgerService
    participant Repo as LedgerRepository
    participant DB as RxDB Local Collection
    participant Repl as Replication Coordinator
    participant Backend as GoogleDriveSyncBackend
    participant Drive as Google Drive / Sheets API

    %% 1. Synchronous Local-First Execution (0ms UI latency)
    Client->>SDK: ledger(groupId).addExpense(payload)
    SDK->>Ledger: validate(payload, userContext)
    Ledger->>Ledger: Enforce Domain Rules & Splits Calculation
    Ledger->>Repo: addExpense(expense)
    Repo->>DB: expenses.insert(expenseJson)
    DB-->>Repo: Document Inserted
    Repo-->>Ledger: Success
    Ledger-->>SDK: Expense Domain Entity
    SDK-->>Client: Immediate Success (0ms UI update)

    %% 2. Asynchronous Background Replication
    critical Background Sync & Structural Healing
        DB->>Repl: RxChangeEvent (expense inserted)
        Repl->>Backend: pushChanges("expenses", [expenseJson])
        Backend->>Backend: Check Remote Schema
        opt Remote Sheet Missing Columns
            Backend->>Drive: ValidationService.repairFile(groupId)
            Drive-->>Backend: 200 Columns Appended
        end
        Backend->>SheetDataMapper: SheetDataMapper.mapFromExpense(expenseJson)
        Backend->>Drive: spreadsheets.values.batchUpdate(...)
        Drive-->>Backend: 200 OK
        Backend-->>Repl: Push Completed
    end
```

## Domain Taxonomy: Group → Account → User

Quozen decouples authenticated Google identities (**Users**) from ledger balance entities (**Accounts**):

- **Group**: A collaborative expense ledger backed by a Google Spreadsheet.
- **Account** (`Member` row in the `Members` tab): A balance sheet and split unit within a Group.
  - **Personal Account**: Managed by a single logged-in User (`accountId === user.id`).
  - **Shared Account**: Co-managed by 2+ logged-in Users (e.g., `"Garcia Family"`). Counts as **1 share** in equal splits.
  - **Offline Account**: Managed on behalf of a non-logged-in participant by any logged-in group member.
- **User** (`User`): An authenticated Google identity (`id`, `email`, `name`).

### Active Account Resolution (`effectiveAccountId`)
- Each user's per-group account binding is stored in `UserSettings.groupCache[].accountId` (defaulting to `user.id` when omitted).
- `LedgerService` resolves `effectiveAccountId` via `activeAccountId ?? getActiveAccountId() ?? user.id`:
  - **Authorization**: `addExpense` authorizes mutations when either `user.id` or `effectiveAccountId` exists in `Members`.
  - **Zero Row Migration**: When `accountId` is explicitly linked (`accountId !== user.id`), `LedgerService.getLedger()` skips JIT `migrateUser` so the Shared or Offline Account's `userId` and historical rows remain untouched.

