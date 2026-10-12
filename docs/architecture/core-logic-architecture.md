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
        Backend->>Backend: SheetDataMapper.mapFromExpense(expenseJson)
        Backend->>Drive: spreadsheets.values.batchUpdate(...)
        Drive-->>Backend: 200 OK
        Backend-->>Repl: Push Completed
    end
```
