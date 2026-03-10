# **Implementation Plan: AI Feature Hardening & Automated Live Testing**

**Objective:** Stabilize the AI Agentic UI by minimizing the LLM's computational responsibilities, centralizing all business logic and error handling inside the `@quozen/core` package, enforcing user locale preferences, and building a fully automated live E2E testing pipeline using real Google Drive credentials.

## **🛑 Pre-conditions for Developers**

1. **Local AI Engine:** Ollama must be running locally with a tool-capable model (e.g., `ollama run qwen3:0.6b` or `qwen2.5:0.5b`).  
2. **Valid Authentication:** The developer must have run `npm run cli -- login` to generate a valid `~/.quozen/credentials.json` file.  
3. **Running Services:** The Edge AI Proxy must be running locally (`npm run dev:ai` on port 8788\) for the live tests to connect to.

---

## **🛠️ Phase 1: Core Consolidation & Payload Minimization (The "Thin LLM" Strategy)** [DONE]

*Goal: The LLM should only extract user intent (amount, description, payer). The core codebase must handle all dates, math, splits, and error formatting.*

* \[ \] **Task 1.1: Simplify AI Tool Schemas (`packages/core/src/agent/tools.ts`)**  [DONE] 
  * Refactor the `addExpense` schema to remove the complex `splits` array requirement.  
  * Remove `date` from the schema entirely (the code should default to `new Date()`).  
  * Introduce an optional boolean parameter (e.g., `splitEqually: true`) or instruct the LLM to omit splits if it's an even distribution.  
* \[ \] **Task 1.2: Shift Split Math to Core (`packages/core/src/finance/LedgerService.ts`)**  [DONE]
  * Modify `LedgerService.addExpense` to handle payloads where `splits` are empty or omitted.  
  * If omitted, the service must automatically fetch the current group members and use the existing `distributeAmount` utility to calculate penny-perfect splits programmatically before saving to Google Drive.  
* \[ \] **Task 1.3: Inject Language / Locale (`packages/core/src/agent/Orchestrator.ts`)**  
  * Update the `OrchestratorContext` interface to require the user's `locale` (e.g., "en", "es").  
  * Modify `AgentOrchestrator.buildSystemPrompt` to explicitly instruct the LLM: *"You must understand and reply in the following language code: \[locale\]."*  
* \[ \] **Task 1.4: Bulletproof Parsing & Error Normalization (`packages/core/src/agent/QuozenAI.ts`)**  [DONE]
  * Implement a safe JSON parsing wrapper for `response.arguments` (since local models often return strings instead of objects).  
  * Catch all exceptions (Validation, Math, JSON parsing, Network) inside `executeCommand`.  
  * Ensure the method *always* returns a standardized `{ success: boolean, message: string }` object, preventing raw JavaScript stack traces (like "Invalid time value") from leaking to the clients.

## **🧪 Phase 2: Live Test Infrastructure Extraction** [DONE]

*Goal: Enable zero-intervention, fully automated testing against real Google Drive APIs using the CLI's saved credentials.*

* \[ \] **Task 2.1: Extract Credential Management (`packages/core/src/auth/local-credentials.ts`)**  [DONE]
  * Move the `getCredentials` and `refreshAccessToken` functions out of `apps/cli/src/quozen.ts` and into the `@quozen/core` package.  
  * Ensure they securely read/write from `~/.quozen/credentials.json`.  
  * Refactor the CLI to import these from `@quozen/core`.  
* \[ \] **Task 2.2: Build Automated Live AI Test (`packages/core/tests/agent/live-e2e.test.ts`)**  [DONE]
  * Create a new Vitest suite explicitly designed for live end-to-end testing.  
  * **Setup:** Programmatically load the credentials from the local file, instantiate `QuozenClient` with the real `GoogleDriveStorageLayer`, and connect the `ProxyAiProvider` to `http://localhost:8788`.  
  * **Execution:** Send the prompt: `"Agrega 100 de gastos en un restaurante a dividir entre todo el grupo"`.  
  * **Assertion:** Verify the `executeCommand` returns `success: true` and that querying the real Google Sheet ledger reflects the new $100 expense split perfectly among all group members.

## **💻 Phase 3: Client Thinning & Alignment** [DONE] 

*Goal: Ensure the WebApp and CLI are dumb visual layers that do not process AI responses.*

* \[ \] **Task 3.1: Pass Locale from Settings to AI (`packages/core/src/agent/QuozenAI.ts` & Clients)**  [DONE]
  * Update the initialization/execution of `QuozenAI` in the WebApp (`useAgent.ts`) to fetch `settings.preferences.locale` and pass it to the Orchestrator.  
  * Do the exact same in the CLI (`interactive.ts`), fetching the locale from the `quozen.groups.getSettings()` call.  
* \[ \] **Task 3.2: Clean WebApp Agent Hook (`apps/webapp/src/features/agent/useAgent.ts`)**  
  * Audit the hook to remove any residual data manipulation or error parsing. It should only call `executeCommand` and pipe `result.message` directly into the Shadcn Toast component.  
* \[ \] **Task 3.3: Clean CLI Agent Flow (`apps/cli/src/interactive.ts`)**  
  * Audit the CLI's `ask_ai` switch block. Ensure it properly handles the standardized `{ success, message }` response without crashing or attempting to parse dates/arguments itself.

---

### **📝 Notes for Developers**

1. **The Math Rule:** LLMs are linguistic engines, not calculators. Never ask the LLM to perform division (e.g., $100 / 3). It will confidently hallucinate penny distributions (e.g., 33.33, 33.33, 33.33 \-\> sum \= 99.99). The AI must simply report: *"Amount: 100, Action: addExpense"*. The `@quozen/core` package will handle the 33.34, 33.33, 33.33 math.  
2. **Schema Drift:** Be mindful that modifying `tools.ts` impacts the Edge Proxy validation. Keep the schemas as loose and resilient as possible (e.g., everything optional except `amount` and `description`).  
3. **Test Safety:** The live E2E test will interact with your real Google Drive. We should ensure the test creates a temporary "Quozen \- AI Test Group" on initialization and deletes it during teardown to avoid polluting the developer's personal ledger.


# **📐  AI Testing Taxonomy Improvements**

To achieve a full, extensible suite, we will restructure the tests into three distinct tiers:

#### **Tier 1: Pure Unit Tests (Fast, No LLM, No Network)**

* **Goal:** Verify the internal logic, error catching, and routing of the Quozen AI modules.  
* **Files:** \* `AiProviderFactory.test.ts`  
  * `QuozenAI.unit.test.ts` *(Renamed)*: We will mock the LLM to return garbage data, missing parameters, and unsupported tools to ensure our core never crashes.

#### **Tier 2: The LLM Intelligence Matrix (Live LLM \+ InMemory Storage)**

* **Goal:** Evaluate the chosen LLM's ability to extract intent and pick the right tools from natural language, using the blazing-fast `InMemoryAdapter`.  
* **File:** `llm-behavior.test.ts` *(Renamed from `live-ollama-memory`)*  
* **Architecture:** We will build a data-driven test array (a matrix). This makes it trivial to add new features later. We will test:  
  1. **Expense Creation:** (e.g., "Add $50 for gas", "I paid $100 for dinner")  
  2. **Settlement Creation:** (e.g., "I just paid Alice $20", "Record that Bob gave me $50 in cash")  
  3. **Language Support:** (e.g., "Agrega 50 de gastos...", "Pagué 20 a Juan")  
  4. **Out-of-Bounds Rejection:** (e.g., "What is the capital of France?", "Delete the group") \-\> *Ensure the LLM safely refuses to answer or triggers the fallback message.*

#### **Tier 3: E2E Infrastructure Smoke Test (Live LLM \+ Proxy \+ Real Drive)**

* **Goal:** Prove the physical network architecture works without getting rate-limited by Google.  
* **File:** `infrastructure-smoke.test.ts` *(Renamed from `live-proxy-drive`)*  
* **Architecture:** A single test block that creates a real group, asks the AI to add an expense, asks the AI to settle the debt, verifies the real Google Sheet balances are $0.00, and deletes the group.

---

### **📋 Execution Plan & Task Breakdown**

Here are the specific tasks to implement this architecture. 

**Phase 1: Clarify & Harden Unit Tests**

* \[ \] Rename `QuozenAI.test.ts` to `QuozenAI.unit.test.ts`.  
* \[ \] Add strict unit tests for:  
  * LLM returns invalid JSON string.  
  * LLM tries to call a non-existent tool (e.g., `deleteExpense`).  
  * LLM returns a valid tool but is missing required parameters (e.g., missing `amount`).

#### **Phase 2: Build the LLM Intelligence Matrix (Tier 2\)**

* \[ \] Rename `live-ollama-memory.test.ts` to `llm-behavior.test.ts`.  
* \[ \] Refactor the test setup to instantiate the `QuozenClient` (with `InMemoryAdapter` and 3 dummy users) in a `beforeAll` block.  
* \[ \] Implement a `test.each([...])` array matrix to loop through various prompts and expected outcomes.  
* \[ \] Add test cases verifying that:  
  * The LLM picks the `addExpense` tool and parses amounts correctly.  
  * The LLM picks the `addSettlement` tool, correctly identifying the `fromUserId` and `toUserId` based on natural language ("I paid Bob" vs "Bob paid me").  
  * The core safely handles out-of-domain chatter.

#### **Phase 3: Consolidate the Infrastructure Smoke Test (Tier 3\)**

* \[ \] Rename `live-proxy-drive.test.ts` to `infrastructure-smoke.test.ts`.  
* \[ \] Combine the AI prompt execution and the mathematical verification into a single, cohesive user journey:  
  1. Create Group.  
  2. Prompt: "I paid $100 for dinner." (AI adds expense, core splits it).  
  3. Prompt: "Bob paid me his share." (AI adds settlement).  
  4. Assert real Google Drive ledger shows Bob's balance is exactly $0.

#### **Phase 4: Update NPM Scripts**

* \[ \] Update `package.json` so that `npm run test:ai:live` specifically targets the new naming convention (e.g., running `llm-behavior` and `infrastructure-smoke`).
