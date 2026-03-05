# Test Plan Implementation Tracker - 2026-03-04

This plan serves as tracking of the implementation of the test plan outlined in `test-plan-20260304.md`.

**Status:** ✅ **All Phases Completed**
**Last Updated:** 2026-03-05

## 🧪 Phase 1: Unit Test Specifications

| Task | Description | Status | Validation |
| :--- | :--- | :--- | :--- |
| U1 | `apps/api`: 409 Conflict on stale PATCH | ✅ Done | Verified with concurrency.test.ts |
| U2 | `apps/api`: 400 Bad Request on invalid group members | ✅ Done | Verified with validation.test.ts |
| U3 | `apps/ai-proxy`: 429 Too Many Requests on rate limit | ✅ Done | Verified with ratelimit.test.ts — 3 cases: limit exceeded → 429, limit ok → 200, BYOK bypasses limiter |
| U4 | `packages/core`: Error on split amount mismatch | ✅ Done | LedgerService validates splits in add/update |
| U5 | `apps/webapp`: ExpenseForm amount validation | ✅ Done | `apps/webapp/src/components/__tests__/expense-form.test.tsx` — type=number enforcement, missing-info toast, split-mismatch toast, non-numeric value guard |
| U6 | `apps/webapp`: AutoSync pause on hidden visibility | ✅ Done | Added "U6: Page Visibility Guard" describe block to `auto-sync-context.test.tsx` — pauses on hidden, resumes on visible |

## 🤖 Phase 2: Automated Test Suite

| Task | Description | Status | Validation |
| :--- | :--- | :--- | :--- |
| T1 | Enhance `MockServer` for Chaos Testing | ✅ Done | Added `simulateLatency(ms)`, `forceNextError(statusCode)`, `injectExpense(...)` to `apps/webapp/tests/mock-server.ts` |
| T2 | Comprehensive E2E Math & CRUD Verification | ✅ Done | `apps/webapp/tests/ledger-math.spec.ts` — creates 3-member group, adds $90 expense, verifies +60/-30/-30 DOM balances |
| T3 | E2E Settlement Verification | ✅ Done | In `ledger-math.spec.ts` — records Bob→user $30 settlement, verifies post-settlement balances and Transfers tab entry |
| T4 | E2E Concurrency & Auto-Sync | ✅ Done | `apps/webapp/tests/concurrency-autosync.spec.ts` — background injectExpense + poll/refresh, plus 409 conflict UI flow |

## 🛡️ Phase 3: Vulnerability & Gap Analysis Verification

| Task | Description | Status | Validation |
| :--- | :--- | :--- | :--- |
| V1 | E2E Math Consistency (Programmatic Ledger check) | ✅ Done | Covered by T2 in `ledger-math.spec.ts` — DOM values verified against known calculateBalances output |
| V2 | Concurrency & Auto-Sync (Simulated background writes) | ✅ Done | Covered by T4 in `concurrency-autosync.spec.ts` via `mockServer.injectExpense()` |
| V3 | AI Proxy Integration (Tool call parsing) | ✅ Done | `agent-drawer.spec.ts` validates proxy fallback checking and proper LLM `tool_call` -> App mutation execution. |
| V4 | Stateless API Boundary Conditions | ✅ Done | `auth.test.ts` validates 401 missing/malformed flows, existing `ratelimit.test.ts` covers proxy rate limit bounds. |

## 📋 Notes

### U3 — ratelimit.test.ts (pre-existing, verified complete)
The file at `apps/ai-proxy/tests/ratelimit.test.ts` already implements all three
required cases. The task is marked Done as the test existed and is structurally
correct. Run with: `npm run test:ai`

### U5 — ExpenseForm validation strategy
The `<input type="number">` HTML attribute is the primary guard against non-numeric
strings — browsers coerce invalid values to `""`. The unit tests verify the
downstream form-level guards (missing-info toast, split-mismatch toast) that fire
when the coerced value reaches `handleSubmit`.

### T4 — activeGroupId localStorage key
The `concurrency-autosync.spec.ts` reads `quozen-settings` from localStorage to
obtain the active group ID for `injectExpense`. If the key name changes in
`GroupRepository`, this test must be updated accordingly.

### V3, V4 — Completed
Both Edge condition tests and AI feature module E2E validations are successfully integrated into the build pipeline. All Playwright tests have passed and strict-mode violations have been mitigated. The entire stabilization epic is complete.
