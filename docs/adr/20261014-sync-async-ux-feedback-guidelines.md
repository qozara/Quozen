# Architecture Decision Record: Sync & Async Operations, Feedback & UI Blocking Guidelines

## Context
Quozen is architected around a dual storage paradigm:
1. **Local-First Persistence (0ms perceived latency)**: Handled by RxDB (Dexie / IndexedDB). Mutations (adding/editing/deleting expenses, debt settlements, switching accounts, renaming accounts) persist immediately to the local database and propagate reactively across UI components via RxDB observable subscriptions at 60fps.
2. **Cloud-Dependent Operations (>300ms latency)**: Communication with Google Drive and Google Sheets REST APIs (creating groups, updating Drive file permissions, deleting/leaving Drive files, importing files via Google Picker). These remote calls take 300ms to 3500ms depending on network latency and rate limits.
3. **Continuous Background Replication**: Managed by `ReplicationCoordinator` to synchronize local RxDB changes with remote Google Sheets without blocking user interaction.

Previously, the app had inconsistent feedback mechanisms:
- Local-first operations spawned redundant, intrusive success toasts (e.g. "Switched active account", "Account renamed", "Switched group", "Synced") that cluttered the mobile viewport.
- Slow remote operations (>300ms), such as pre-fetching members before editing a group ledger or importing a group via Google Picker, lacked proper UI blocking, leaving users with no visual feedback or using floating toasts as loading indicators.
- Transient background replication errors flooded users with destructive toasts despite the presence of a dedicated `SyncTrigger` widget in the header.

## Decision

To establish a predictable, high-performance, mobile-first experience, all present and future features in Quozen MUST adhere to the following 5 guidelines:

### 1. Reactive UI as Feedback (Zero Success Toasts for Local Operations)
For any operation that writes optimistically or synchronously to local RxDB storage with 0ms perceived latency:
- **No success toasts**: Never trigger `toast({ title: "Success", ... })` or similar popups for successful local mutations.
- **Visual feedback**: The feedback is the immediate reactive update itself (animated drawer/modal closing, numbers updating, badges moving, list items re-sorting) paired with optional subtle tactile haptics (`navigator.vibrate?.(50)`).
- **Error handling**: Destructive error toasts are retained strictly for catastrophic local write failures.

### 2. Mandatory UI Blocking for Remote Operations (>300ms)
Any synchronous remote operation that communicates with Google Drive, Google Sheets, or an external cloud API taking >300ms MUST prevent conflicting user interaction and provide immediate visual indicators:
- **Pre-fetch Loading State**: When an action triggers an asynchronous fetch prior to opening a form (e.g. clicking "Edit" on a group ledger row), the trigger button or item MUST display an inline spinner (`<Loader2 className="animate-spin" />`) and disable interaction until resolved.
- **Non-Dismissible Drawers**: Drawers or dialogs executing remote cloud mutations MUST set `dismissible={!isPending}` (and guard `onOpenChange`) to prevent swipe-to-dismiss or backdrop click cancellation while the remote operation is in flight.
- **Inline Submit Spinners**: The submit or confirmation button MUST be disabled and display an inline spinner with a progressive label (e.g., "Saving...", "Deleting...", "Leaving...").
- **Modal Loading Overlays for Imports**: Long-running blocking operations like Google Drive Picker imports MUST render a full-screen or modal backdrop overlay (`"Importing group from Google Drive..."`) rather than floating toasts.
- **Silent Success Closure**: On successful resolution of the remote call, the dialog/modal closes and invalidates queries without showing a success toast.

### 3. Confinement of Toasts to Actionable Failures
Toasts are strictly reserved for:
1. Terminal, user-actionable asynchronous failures (e.g., Google Drive API returns 403 Forbidden, 404 Not Found, or network failure).
2. Explicit data conflict or corruption errors (`ConflictError`, `NotFoundError`).
3. Form validation errors where inline field feedback is absent.

### 4. Passive Background Sync Diagnostics
- Transient network glitches, rate-limiting (`"throttled"`), or retry blips encountered by background replication (`ReplicationCoordinator`) MUST NOT spawn floating error toasts.
- Background sync health is passively communicated via the header `SyncTrigger` component, which displays state glyphs (spinning = syncing, amber = warning, grey = offline) and provides an on-demand inspector popover (`SyncInspectorPopover`).
- Toasts in background contexts are restricted to terminal authorization loss (`"auth_failed"`).

### 5. In-Place Micro-Interactions over Toasts for Utility Actions
- Ephemeral utility actions (such as copying an invite link to the clipboard or triggering manual sync) MUST use in-place icon/button state transitions (e.g. transitioning the button icon to `<Check className="text-green-500" />` for 2 seconds, or spinning `<RefreshCw className="animate-spin" />`) rather than spawning floating toast popups.

## Consequences
- **Cleaner Mobile Ergonomics**: The mobile screen remains unobstructed by toast notifications during everyday usage.
- **Zero Ambiguity During Remote Work**: Users clearly see when Google Drive is being contacted and are prevented from triggering race conditions or duplicate submissions.
- **Consistent Developer Conventions**: Future features, PRs, and AI subagents have unambiguous rules on when to use UI blockers, spinners, and toasts.
