# Architecture Decision Record: Smart Sync / Auto Polling

## Context
Collaborative use of Quozen led to stale data if users didn't manually hit the "Refresh" button. A mechanism was needed to automate synchronization without running into Drive API rate limits or destroying local input data when a user was typing.

## Decision
1. **Lightweight Polling:** The system polls `GET /files/{activeGroupId}?fields=modifiedTime` at a set interval (e.g., 30s) instead of fetching the whole Sheet. If `remoteTime > localTime`, it triggers a full query-cache invalidation.
2. **Strict Edit-Safety Hooks (Pausing):** 
   - Route-based: The sync is forcibly paused when active paths include `/add-expense`, `/edit-expense`, or `/join`.
   - Modal-based: Global context allows modals like `SettlementModal` to pause synchronization while open.
3. **Smart Backoff via Visibility:** Polling immediately stops when the browser tab loses focus (`document.visibilityState`) saving user bandwidth and device battery.
4. **UI Implications:** When polling is enabled, the manual "Refresh" button in the header is hidden. A "Pull-to-Refresh" gesture is implemented for users wanting immediate manual sync while auto-mode is active.

## Consequences
- Requires introducing a global `AutoSyncContext` to share the `isPaused` state between Route Guards, Modals, and the Polling Hook.
- Drastically improves UX for concurrent users but introduces minor logic overhead to ensure no "mid-edit" syncs happen.
