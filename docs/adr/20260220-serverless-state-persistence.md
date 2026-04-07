# Architecture Decision Record: Serverless User Settings & State Persistence

## Context
Quozen operated statelessly, relying on expensive O(N) full-drive scans on every application load to find user groups. This resulted in poor performance and quota exhaustion, as well as an inability to retain cross-session state (like the last active group).

## Decision
1. **Serverless Database:** Implemented a `quozen-settings.json` file in the root of the user's Google Drive. 
2. **Write-Through Cache:** This JSON file acts as a repository for both Data (cached group IDs and names) and Metadata (user preferences, active group). Every group operation updates the React Query state locally while simultaneously persisting the change to Drive.
3. **Lazy Reconciliation:** Full Drive scanning is completely disabled during standard load. The app assumes the cache is the source of truth unless the file is missing or the user manually triggers a reconciliation scan form the Profile page.

## Consequences
- App load time ("Checking for groups...") reduced by 80%.
- Refreshing the UI (via the header button) only requires an O(1) fetch of the active group spreadsheet, avoiding Drive list operations altogether.
