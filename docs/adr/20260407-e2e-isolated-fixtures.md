# Architecture Decision Record: Isolated E2E Test Fixtures

## Context
The Playwright E2E suite suffered from race conditions, flakiness, and non-deterministic behavior because it relied on global singletons (like `export const mockServer = new MockServer()`), arbitrary `setTimeout` waits, and manual human intervention for OAuth logins.

## Decision
1. **Isolated Playwright Fixtures:** The `MockServer` singleton is removed. Tests use Playwright's contextual fixtures to spin up isolated mock environments and page route intercepts per test, enabling `fullyParallel: true` execution without state collisions.
2. **Deterministic Sync Variables:** `window.__forceSync()` is exposed in the E2E build to eliminate time-based polling overrides.
3. **Headless Cloud Authentication:** Cloud E2E tests skip manual UI logins completely by directly generating and injecting Google OAuth2 refresh tokens into the browser's storage state in `tests/global-setup.ts`.

## Consequences
- E2E tests run instantly and deterministically.
- Timeouts and race conditions (due to concurrent network intercept mutations) are entirely eliminated. 
