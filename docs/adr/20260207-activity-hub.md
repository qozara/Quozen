# Architecture Decision Record: Activity Hub & Transfers

## Context
The application needs a centralized ledger view for groups ("Activity Hub"). The complexity stems from combining external consumption (Expenses) with internal redistribution (Transfers) while keeping cognitive load low for individual users.

## Decision
1. **Unified Hub, Split Tabs:** Replace the standalone "All Expenses" view with a unified `Activity Hub` containing `Expenses` and `Transfers` tabs. Persist tab state via URL query params.
2. **Me-Centric Visualization:** Color coding (Green for inbound money, Orange for outbound money) is strictly applied *only* when the transaction impacts the logged-in user. Third-party transfers between other group members are rendered in a neutral muted grey.
3. **Derived State:** Transfers are a visual derivation of the underlying `settlements` array. They are filtered based on a toggle switch ("My Transfers" vs "Show All").
4. **Editing Architecture:** The existing `SettlementModal` is refactored to accept `initialData` for editing functionality, avoiding duplicating UI code.

## Consequences
- Requires a refactor of the `expenses.tsx` into `activity-hub.tsx`.
- Introduces robust directional logic in the `TransferCard` component to handle color-coding based on the `currentUser` compared to `fromUserId` and `toUserId`.
- Decreases cognitive load for users checking their own balances but allows full transparency for group admins via the "Show All" toggle.
