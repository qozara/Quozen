# ADR: Strict Schema Validation and UI Remediation

## Context
While the core library (`@quozen/core`) and CLI were equipped for schema evolution (PR #54), the browser application (`apps/webapp`) and stateless REST API (`apps/api`) remained decoupled from these capabilities. This led to several issues:
1. **Uncaught Schema Errors**: Outdated schemas caused silent failures or generic error boundaries instead of actionable remediation steps.
2. **Auto-Sync Collisions**: Background polling could fetch a newly migrated schema, crash, and enter infinite refetch loops.
3. **Race Conditions**: Concurrent user upgrades on the same spreadsheet could result in 409 Conflicts or duplicate columns due to a lack of Optimistic Concurrency Control (OCC).
4. **AI Agent Incompatibility**: The Edge API returned generic 500 errors instead of structured 422 Unprocessable Entity errors, preventing AI agents from self-healing.

## Decision
We implemented a strict gatekeeper pattern with explicit remediation flows across the stack:

1. **Proxy/Gatekeeper Pattern**: `getLedger()` proxies requests through `ValidationService.checkHealth()` before allowing `SheetDataMapper` to execute. If validation fails, it throws a `SchemaCorruptedError` or `SchemaUpgradeRequiredError`.
2. **State Pattern**: Spreadsheets transition through `READY`, `UPGRADE_REQUIRED`, `CORRUPTED`, and `INCOMPATIBLE`.
3. **Optimistic Concurrency Control (OCC)**: Migrations and repairs enforce OCC using the spreadsheet's `modifiedTime` (`If-Match` headers) as a pre-condition lock to prevent race conditions during concurrent upgrades.
4. **Edge API Enforcement**: The Edge API exposes `/schema-status`, `/migrate`, and `/repair`. It traps schema exceptions during `/ledger` reads and returns structured `422 Unprocessable Entity` responses.
5. **Intercept & Remediate Pattern (UI)**: React Query interceptors in the WebApp catch 422 schema errors, updating the global `AppContext`. This triggers a global `SchemaRemediationModal` (using Vaul Drawer) to guide the user through a one-click upgrade or repair, while automatically suspending background polling.

## Consequences
- **Positive**: Users are now actively guided to repair corrupted sheets or upgrade outdated schemas without application crashes. AI agents can detect 422 schema errors and autonomously call the `/migrate` endpoint.
- **Positive**: Concurrency risks during upgrades are eliminated via strict ETag locking.
- **Negative**: Adds a slight latency overhead to `getLedger()` as it must verify metadata before processing, though this is mitigated by relying on lightweight `appProperties` checks.
