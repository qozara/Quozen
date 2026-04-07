# Quozen Testing Architecture & Guidelines

## ⚠️ STRICT WARNING FOR AGENTS & DEVELOPERS ⚠️
**Do NOT write E2E tests against the real Google Drive API unless reproducing a specific file-system anomaly.**
Always default to Mocked E2E tests to prevent flaky CI pipelines and accidental Google Drive quota exhaustion.

## Test Strategy Decision Flow

1. **Tier 1: Pure Unit Test** (Vitest, InMemoryAdapter)
   - Use for: Core business logic, APIs, and WebApp component unit tests.
   - Command: `npm run test`
2. **Tier 2: Intelligence Matrix** (Node, Local Ollama)
   - Use for: Validating LLM intent extraction and tool calling behavior.
   - Command: `npm run test:ai:llm-behavior`
3. **Tier 3a: Mocked E2E** (Playwright + MockServer)
   - Use for: UI interaction, edge cases (409s, 429s, Latency), Auth bypass.
   - Command: `npm run test:web:e2e`
4. **Tier 3b: Cloud E2E** (Playwright + Real Auth)
   - Use for: Testing actual Google Drive anomalies or edge proxy infrastructure.
   - Command: `npm run test:web:cloud` or `npm run test:ai:live-smoke-test`

## Mock Infrastructure Guide

### `MockServer` (`apps/webapp/tests/mock-server.ts`)
The `MockServer` intercepts network requests in Playwright to simulate backend conditions without hitting real APIs.
- **`simulateLatency(ms)`**: Injects artificial delay. Use to test loading states and optimistic UI updates.
- **`forceNextError(statusCode)`**: Forces the next intercepted request to fail (e.g., `409`, `429`, `500`). Use this to test UI error boundaries and retry logic without complex network mocking.
- **`injectExpense(groupId, expense)`**: Directly appends an expense to the `InMemoryAdapter`. Use this to simulate background writes by other users to trigger Optimistic Concurrency Control (OCC) and Auto-Sync behaviors.

### `VITE_USE_MOCK_STORAGE` and Auth Bypass
- When `VITE_USE_MOCK_STORAGE=remote` (or `true`), the application uses the `RemoteMockAdapter` which routes requests to the Playwright `MockServer`.
- The `setupAuth(page)` utility in Playwright tests detects this mode and injects a static `mock-token-123` into localStorage, completely bypassing the Google OAuth login flow for fast, reliable, unattended CI execution.

## AI & Agent Testing

To achieve a full, extensible suite, we have restructured the AI tests into distinct tiers:

### Tier 1: Pure Unit Tests (Fast, No LLM, No Network)
* **Goal:** Verify the internal logic, error catching, and routing of the Quozen AI modules.
* **Files:** `AiProviderFactory.test.ts`, `QuozenAI.unit.test.ts`
* We mock the LLM to return garbage data, missing parameters, and unsupported tools to ensure our core never crashes.

### Tier 2: The LLM Intelligence Matrix (Live LLM + InMemory Storage)
* **Goal:** Evaluate the chosen LLM's ability to extract intent and pick the right tools from natural language, using the blazing-fast `InMemoryAdapter`.
* **File:** `llm-behavior.test.ts`
* **Architecture:** A data-driven test array (matrix) testing Expense Creation, Settlement Creation, Language Support, and Out-of-Bounds Rejection. Runs via `npm run test:ai:llm-behavior` (requires local Ollama).

### Tier 3: E2E Infrastructure Smoke Test (Live LLM + Proxy + Real Drive)
* **Goal:** Prove the physical network architecture works without getting rate-limited by Google.
* **File:** `infrastructure-smoke.test.ts`
* **Architecture:** A single test block that creates a real group, asks the AI to add an expense, asks the AI to settle the debt, verifies the real Google Sheet balances are $0.00, and deletes the group. Runs via `npm run test:ai:live-smoke-test`.
