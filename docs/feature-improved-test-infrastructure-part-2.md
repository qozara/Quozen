# **Technical Design Document: Testing Infrastructure & TDD Guidelines**

**Epic:** Testing Infrastructure Documentation & Developer/Agent Guidelines **Role:** Principal Software Architect / Tech Lead **Status:** Ready for Engineering

## **1\. HIGH-LEVEL ARCHITECTURE**

### **System Context**

Quozen’s architecture relies on decentralized, client-side interactions with third-party services (Google Drive, Vercel Edge Proxy, Local Ollama). Consequently, the testing infrastructure has evolved into a highly sophisticated, multi-tiered system. It utilizes Dependency Injection (`InMemoryAdapter` vs `GoogleDriveStorageLayer`), Network Interception (Playwright `MockServer`), and Conditional Execution (`RUN_LOCAL_LLM_TESTS`).

Currently, this complexity is scattered across configuration files, package scripts, and isolated READMEs. To enable seamless future development (especially via AI coding agents operating autonomously), we must centralize this knowledge into a definitive architecture document. This ensures new features strictly adhere to the "Mock First, Cloud Last" testing philosophy, preventing flaky CI pipelines and accidental Google Drive quota exhaustion.

### **Design Patterns**

1. **Tiered Test Pyramid Pattern:** Categorizing tests by external dependencies (Pure Unit \-\> Local Integration/LLM \-\> Mocked E2E \-\> Cloud E2E).  
2. **Dependency Injection (DI) Strategy:** Documenting how `@quozen/core` accepts storage adapters to isolate business logic from network calls.  
3. **Chaos Engineering & Interception:** Documenting the `MockServer` usage in Playwright for simulating `409 Conflict`, `429 Rate Limit`, and high latency without touching real APIs.

### **Diagrams: Test Strategy Decision Flow**

flowchart TD  
    Start(\[New Feature / Refactor Planned\]) \--\> Q1{Does it require UI interaction?}  
      
    Q1 \-- No (Core/API) \--\> Q2{Does it require an LLM?}  
    Q1 \-- Yes (WebApp) \--\> Q3{Does it test Edge Cases / UI States?}  
      
    Q2 \-- No \--\> T1\[Tier 1: Pure Unit Test\<br\>Vitest, InMemoryAdapter\<br\>Runs instantly in CI\]  
    Q2 \-- Yes \--\> T2\[Tier 2: Intelligence Matrix\<br\>Local Ollama \+ InMemoryAdapter\<br\>Skipped in CI unless configured\]  
      
    Q3 \-- Yes \--\> T3\[Tier 3a: Mocked E2E\<br\>Playwright \+ MockServer\<br\>Simulates 409s, Latency, Auth Bypass\]  
    Q3 \-- No (Core Sync/Drive specific) \--\> Q4{Does it test actual Google Drive anomalies?}  
      
    Q4 \-- Yes \--\> T4\[Tier 3b: Cloud E2E\<br\>Playwright \+ Real Auth\<br\>Sequential execution, touches real Drive\]  
    Q4 \-- No \--\> T3  
      
    T1 \-.-\> CI((CI Pipeline))  
    T2 \-.-\> Local((Local Dev))  
    T3 \-.-\> CI  
    T4 \-.-\> Local

## **2\. DATA MODEL & PERSISTENCE (Test State Management)**

While this epic does not alter application database schemas, it formalizes the **Test State Data Models** that agents and developers must use to manipulate the environment.

* **Mock State (`InMemoryAdapter` & `MockServer`):** \* **Usage:** Used in 95% of tests.  
  * **Data Structure:** State is held in volatile memory (`Map<string, MockSheet>`).  
  * **Agents Rule:** Agents must use `mockServer.injectExpense()` or `mockServer.forceNextError()` to manipulate state in Playwright tests, rather than attempting to navigate the UI to set up edge cases.  
* **Cloud State (`GoogleDriveStorageLayer`):** \* **Usage:** Restricted to `/reproduce_issues.spec.ts` and `infrastructure-smoke.test.ts`.  
  * **Data Structure:** Real Google Drive API.  
  * **Agents Rule:** Agents must ensure test cleanup (`deleteGroup`) runs in a `finally` block or `afterAll` hook to prevent developer Drive clutter.  
* **Auth State (`~/.quozen/credentials.json` vs. LocalStorage Mock):**  
  * **Usage:** Governed by `VITE_USE_MOCK_STORAGE`.  
  * **Agents Rule:** Never prompt the user for API keys in standard E2E tests. Use `setupAuth(page)` which injects the `mock-token-123` bypass.

---

## **3\. API CONTRACTS (Test Execution Interfaces)**

We must document the explicit NPM script contracts so that AI agents know exactly which script to trigger to validate their work without running the entire 5-minute suite unnecessarily.

| Command | Scope | Environment | CI Status |
| :---- | :---- | :---- | :---- |
| npm run test | Tier 1 (Core, API, WebApp Unit) | Node/JSDOM, InMemory | **Mandatory** |
| npm run test:web:e2e | Tier 3a (Playwright Mocked) | Browser, MockServer | **Mandatory** |
| npm run test:ai:llm-behavior | Tier 2 (LLM Validation) | Node, Local Ollama | Skipped by default |
| npm run test:ai:live-smoke-test | Tier 3b (LLM \+ Proxy \+ Drive) | Node, Edge Proxy, Real Drive | Skipped by default |
| npm run test:web:cloud | Tier 3b (Playwright Real Drive) | Browser, Real Drive | Skipped by default |

## **4\. ENGINEER TASK BREAKDOWN**

The following tasks will consolidate the testing architecture into centralized, agent-readable documentation.

**Task \[DOC-01\]: Create `docs/testing-architecture.md`** [DONE]

* **Description:** Create the definitive guide for testing in the repository. It must include:  
  1. The Decision Flow tree (which tier to use).  
  2. Explanation of `MockServer` and how to use `simulateLatency` and `forceNextError`.  
  3. Explanation of `VITE_USE_MOCK_STORAGE` and how `setupAuth()` handles tokens.  
  4. A strict warning to agents/humans: "Do NOT write E2E tests against the real Google Drive API unless reproducing a specific file-system anomaly."  
* **Technical Definition of Done:** Markdown file exists in `/docs`, containing clear code examples of how to inject dependencies for unit tests vs E2E tests.

**Task \[DOC-02\]: Update Root `README.md`** [DONE] 

* **Description:** Refactor the existing "Testing" section in the root `README.md`. Replace the verbose explanations with a high-level summary of the 3 Tiers, and add a prominent link pointing to `docs/testing-architecture.md` for developers and AI agents planning new features.  
* **Technical Definition of Done:** `README.md` is updated and clearly directs readers to the comprehensive guide.  
* **Dependencies:** Blocked by \[DOC-01\].

**Task \[DOC-03\]: Centralize AI Test Documentation** [DONE]  

* **Description:** The file `packages/core/tests/agent/README.md` currently holds valuable tier information. Move this content into the new `docs/testing-architecture.md` under a specific "AI & Agent Testing" section, and replace the contents of `packages/core/tests/agent/README.md` with a link to the central doc.  
* **Technical Definition of Done:** Information is deduplicated. AI agents indexing the repository only have one source of truth for testing infrastructure.

**Task \[CODE-01\]: Add TDD/Agent JSDoc Annotations to Mock Infrastructure** [DONE]

* **Description:** Add verbose JSDoc comments to `apps/webapp/tests/mock-server.ts` and `packages/core/src/storage/memory-adapter.ts`. AI coding assistants (like Copilot/Cursor) heavily weight JSDoc comments when generating autocomplete suggestions.  
  * Annotate `forceNextError` explaining *when* an agent should use it (e.g., "Use this to test UI error boundaries without complex network mocking").  
  * Annotate `injectExpense` explaining it simulates background OCC concurrency.  
* **Technical Definition of Done:** JSDocs successfully added to core testing utilities.
