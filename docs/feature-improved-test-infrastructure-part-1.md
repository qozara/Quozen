# Address Test Infrastructure and E2E Patterns Issues

## Critical Assessment
The current E2E (end-to-end) tests for this project are fundamentally flawed for parallel execution. They rely on singletons, arbitrary timeouts, and need manual human intervention, defeating the purpose of automated CI pipelines.

### Key Problems
- **Singleton Mock Server Anti-Pattern:**
  - In `apps/webapp/tests/mock-server.ts`, a global instance of `MockServer` is exported, but in `playwright.config.ts`, `fullyParallel: true` is set. This causes concurrent mutation of shared state (`InMemoryAdapter`) and unexplained failures.
- **Time-Travel and Polling Race Conditions:**
  - In `concurrency.spec.ts`, there are hacks like overriding polling intervals or manual timeouts (e.g., `window.__QUOZEN_POLLING_OVERRIDE = 1`, `waitForTimeout(2000)`). These practices result in flakiness due to non-deterministic waiting and async cache/render cycles.
- **Manual Human Interventions:**
  - Tests like `reproduce_issues.spec.ts` impose a 5-minute manual login window, making unattended CI execution impossible.
- **Fragile UI Locators:**
  - Reliance on text-matching (e.g., `getByText(/Success/i)`) causes breakages whenever i18n strings change.

---

## Technical Roadmap & Recommendations

### 1. **Adopt Isolated Test Fixtures**
- Refactor test setup to instantiate `MockServer`/backend and its state _per test_, using Playwright [test fixtures](https://playwright.dev/docs/test-fixtures).
- Encapsulate network intercepts and services for each test.
- Remove `export const mockServer = new MockServer();` from `mock-server.ts`. Instead, define custom fixture types and instantiate new `MockServer` and page routes per test.

### 2. **Make All Syncs Deterministic**
- **Remove timeouts** and polling overrides.
- In `src/context/auto-sync-context.tsx`, expose a `window.__triggerAutoSync = triggerSync` debug method in the E2E environment.
- All sync-related E2E tests should invoke `window.__forceSync()` explicitly after state changes.
- Use Playwright's `expect.toPass()` for assertions that depend on async hydration, to retry until condition passes deterministically, instead of waits.

### 3. **Implement Headless OAuth2 Authentication for Cloud Tests**
- In `tests/global-setup.ts`, implement refresh-token exchange with Google (use service code from `packages/core/src/auth/local-credentials.ts`).
- Inject result into Playwright's initial storage, so cloud-mode tests run with a Google account entirely unattended.
- Remove manual login and 300,000ms timeouts from the suite.

### 4. **Strengthen UI Locators for Internationalization**
- Replace all text-matching assertions with strict `data-testid` selectors.
- Ensure all critical DOM assertions use data attributes, not localized strings.

---

## Engineer Task Breakdown

**[E2E-01] Refactor Mock Server to Playwright Fixtures** [DONE]
- Delete singleton in `mock-server.ts`; create `fixtures.ts` for granular per-test servers.
- Update all suite consumers (e.g., `concurrency.spec.ts`, `ledger-math.spec.ts`).
- **Definition of Done:** `npm run test:web:e2e` is reliable in fullyParallel mode.

**[E2E-02] Eliminate Timeouts & Implement Deterministic Sync** [DONE]
- Remove poll overrides and static waits from tests.
- Add `window.__triggerAutoSync` for explicit triggering and update tests accordingly.
- **Definition of Done:** Flaky timeouts eliminated; tests are deterministic and instant.
- **Blocked by:** [E2E-01]

**[E2E-03] Implement Headless Cloud Authentication** [DONE] 
- Script out Playwright auth that bypasses manual intervention using OAuth2.
- Remove timeout/manual login from cloud tests.
- **Definition of Done:** All cloud E2E run unattended end-to-end.

**[E2E-04] Harden UI Locators** [DONE]
- Use `data-testid` selectors instead of text-based assertions.
- **Definition of Done:** i18n language changes do not break locator-based tests.

---

This issue proposes incremental, compatibility-preserving stabilization of the E2E suite across all monorepo workspaces. Implement these improvements to gain trustworthy CI and robust cross-language/cross-environment E2E confidence.