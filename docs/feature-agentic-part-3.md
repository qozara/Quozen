# Requirements specification: THE EPIC

**Title:** AI Core Encapsulation & Polymorphic Providers 

**Description:** Refactor the AI orchestration layer out of the React web application and encapsulate it entirely within `@quozen/core` via a new `QuozenAI` facade and an `AiProviderFactory`. This abstraction standardizes how Quozen interacts with AI, supporting four internal execution modes: Cloud Proxy (Bring Your Own Key), Local Browser AI (`window.ai`), Direct Localhost (Ollama), and a Cloud Proxy fallback (Dev Team Key). Crucially, the Dev Team Key is reserved *strictly* as a last-resort fallback for the "Auto" mode to prevent quota abuse, and is not a manually selectable option. By decoupling the client from specific vendor SDKs, the architecture ensures future-proofing and allows seamless migration to other edge providers (like Cloudflare) or new LLM backends. 

**Success Metrics:**

* **Portability:** The CLI successfully implements an "Ask AI" interactive menu option utilizing the exact same core logic as the web app.  
* **Encapsulation:** The React WebApp's codebase shrinks by removing orchestration, hardcoded setup messages, and fallback logic, relying solely on the new `@quozen/core` interfaces.  
* **Vendor Independence:** Zero Vercel AI SDK or specific LLM vendor dependencies exist within the `@quozen/core` client bundle.  
* **Performance:** The main React bundle size does not increase; the AI features remain strictly lazy-loaded and bypass network checks entirely if configured as "disabled".

---

### **2\. SCOPE & CONSTRAINTS (For the Architect)**

**In-Scope:**

* **Core Interfaces:** Renaming the current `ai-proxy` backend provider interface to `AiSdkAdapter` to avoid naming collisions. Creating a new, vendor-agnostic `AiProvider` interface in `@quozen/core`.  
* **Polymorphic Methods:** The new `AiProvider` interface must mandate `chat()`, `checkAvailability()`, and a `getSetupMessage()` method for UI rendering.  
* **Core Providers:** Implementing `ProxyAiProvider` (handles both Team Key and BYOK states), `WindowAiProvider`, and `LocalOllamaProvider`.  
* **Factory & Auto-Routing:** Implementing `AiProviderFactory.createProvider()` which handles the fallback logic internally for the "Auto" setting.  
* **Facade Pattern:** Creating the `QuozenAI` class which accepts a `QuozenClient` and an `AiProvider` to seamlessly orchestrate RAG context building and tool execution.  
* **WebApp UX:** Updating the Profile settings to dynamically fetch helper text (like CORS warnings for Ollama) directly from the Factory/Provider, ensuring the Team Key option is excluded from manual selection.  
* **CLI Extension:** Adding an "Ask AI" interactive prompt to the CLI.

**Out-of-Scope:**

* Modifying the internal Vercel AI SDK integration inside the `apps/ai-proxy` codebase (beyond interface renaming). The proxy remains responsible for translating our generic schema to the vendor SDKs.  
* Building an auto-installer for Ollama (user must configure `OLLAMA_ORIGINS="*" ollama serve` themselves, guided by the polymorphic setup message).

**Technical Dependencies:**

* `@quozen/core` must expose the new abstractions using standard web fetch APIs to ensure compatibility across Node.js (CLI) and Browser (WebApp) environments.

**NFRs:**

* **Infrastructure Agnostic:** The core abstraction must not assume the proxy is hosted on Vercel. It must rely solely on standard HTTP/REST contracts, allowing the proxy to be moved to Cloudflare Workers or AWS seamlessly.  
* **Bundle Size:** The core app bundle must not load the AI orchestrator or providers if `VITE_DISABLE_AI=true` or if the user setting is `disabled`.

---

### **3\. USER STORIES (For the Engineers)**

**US-101: Core `AiProvider` Abstraction & Implementations**

* **Narrative:** As a Core Architect, I want a unified `AiProvider` interface with multiple implementations, so that the core package can interact with Cloud Proxies, Chrome AI, or Local Ollama without being locked into a specific vendor's SDK.  
* **Scenario 1 (Interface Renaming):** Given the `apps/ai-proxy` workspace, When I inspect the types, Then the existing `AiProvider` interface is renamed to `AiSdkAdapter` to free up the namespace and clarify its role as a backend-only adapter.  
* **Scenario 2 (New Core Interface):** Given `@quozen/core`, When I define `AiProvider`, Then it requires three methods: `chat(request: AgentChatRequest): Promise<AgentChatResponse>`, `checkAvailability(): Promise<boolean>`, and `getSetupMessage(): string | null`.  
* **Scenario 3 (Execution Modes vs. User Selection):** I implement the interface to support four internal execution modes, while enforcing that the "Team Key" is hidden from the UI:  
  1. `ProxyAiProvider` (BYOK): Uses `fetch` to proxy, injecting KMS ciphertext. *(User selectable)*  
  2. `WindowAiProvider`: Uses Chrome `window.ai`. *(User selectable)*  
  3. `LocalOllamaProvider`: Uses `fetch` directly to `http://localhost:11434`. *(User selectable)*  
  4. `ProxyAiProvider` (Team Key): Uses `fetch` to proxy, omitting ciphertext. *(Strictly an internal fallback for "Auto" mode; NOT selectable in the UI)*.  
* **Dev Notes:** Ensure no third-party LLM SDKs are imported into `@quozen/core`. Keep everything standard HTTP/JSON.

**US-102: The `QuozenAI` Facade & Factory**

* **Narrative:** As a Client Developer (Web or CLI), I want to instantiate a single object that handles all AI orchestration, So that I don't have to manually build RAG context or map tool schemas in my client code.  
* **Scenario 1 (Factory Auto-Routing Fallback):** Given I call `AiProviderFactory.createProvider(config)`, When the config is set to "auto", Then the factory evaluates the environment in this exact order: 1\) Checks for BYOK ciphertext \-\> Returns `ProxyAiProvider(BYOK)`. 2\) Checks `WindowAiProvider.checkAvailability()` \-\> Returns `WindowAiProvider`. 3\) As a last resort, returns \-\> `ProxyAiProvider(TeamKey)`.  
* **Scenario 2 (Facade Execution):** Given an initialized `QuozenAI(quozenClient, aiProvider)` instance, When I call `.executeCommand("split lunch with Bob")`, Then the facade handles building the system prompt (RAG), calls the provider's `chat` method, validates the response, and safely executes the returned tool against the `QuozenClient`.

**US-103: Universal Pre-flight & Lazy Loading Refactor**

* **Narrative:** As a Web User, I want the app to remain lightning-fast and verify AI infrastructure gracefully, So that my battery is conserved and the UI doesn't hang on broken connections.  
* **Scenario 1 (Hard Disabled Gate):** Given my settings equal `disabled` (or `VITE_DISABLE_AI=true`), When the app loads, Then `AiFeatureProvider` immediately yields `{ status: 'unavailable' }` and no AI JS chunks are downloaded.  
* **Scenario 2 (Polymorphic Health Check):** Given my settings specify a provider, When the AI chunk lazy-loads, Then the `AiFeatureProvider` blindly calls the universal `provider.checkAvailability()` method. If the underlying network (Proxy, Localhost, or Chrome API) is offline/missing, it sets the status to `unavailable`.  
* **Dev Notes:** Remove the hardcoded `/` proxy fetch from `AiFeatureProvider` and replace it entirely with the polymorphic `checkAvailability()` contract provided by the factory.

**US-104: Polymorphic Setup UI & Error Handling**

* **Narrative:** As a Frontend Developer, I want the UI to query the provider for setup instructions, So that I don't have to write hardcoded `if (model === 'ollama')` logic in the React components.  
* **Scenario 1 (Dynamic Helper Text):** Given I am on the Profile page, When I select an AI Provider from the dropdown, Then the UI calls `AiProviderFactory.getSetupMessage(selectedModel)` and displays the result. For "Local Ollama", it returns: *"Note: Start Ollama with `OLLAMA_ORIGINS="*" ollama serve` to allow browser connections."*  
* **Scenario 2 (Graceful Degradation):** Given I am using the `LocalOllamaProvider`, When the `fetch` to `localhost` fails due to CORS, Then the provider internally catches the `TypeError: Failed to fetch` and returns a standardized error response, triggering a UI Toast without crashing the app.

**US-105: CLI "Ask AI" Integration**

* **Narrative:** As a CLI User, I want to execute commands using natural language, So that I can prove the `@quozen/core` portability and manage expenses faster via terminal.  
* **Scenario 1 (Interactive Menu):** Given I run `npm run cli`, When the interactive menu appears, Then there is a new option: `Ask AI`.  
* **Scenario 2 (Execution):** When I select `Ask AI` and type "I paid $20 for coffee split with Alice", Then the CLI seamlessly instantiates `QuozenAI` (defaulting to the `ProxyAiProvider` with the Team Key, since "Auto" fallback applies), executes the command via the core facade, and prints a success message.  
* **Dev Notes:** Output should utilize terminal styling (`chalk`) for the tool execution confirmation to match the existing CLI aesthetic.

# Implementation Plan (for Software Engineers to implement)

## HIGH-LEVEL ARCHITECTURE

### **System Context**

Currently, the AI intelligence execution loop—building the RAG context, selecting the execution engine (waterfall fallback), and executing mutations against the `QuozenClient`—is tightly coupled to the React application via the `useAgent.ts` hook.

This refactoring extracts the entire AI orchestration layer out of the React UI and encapsulates it into the `@quozen/core` library. We will introduce a series of generic Providers (Strategies), a Factory to resolve the optimal provider, and a Facade (`QuozenAI`) to orchestrate the end-to-end execution. The React web app and the CLI will then act as simple, thin consumers of this `QuozenAI` core class.

### **Design Patterns**

1. **Strategy Pattern (Polymorphic Providers):** `AiProvider` interface with multiple implementations (`ProxyAiProvider`, `WindowAiProvider`, `LocalOllamaProvider`) abstracting the physical HTTP/Browser calls.  
2. **Factory Pattern:** `AiProviderFactory` determines which strategy to instantiate based on user settings, handling the complex "Auto" fallback logic internally.  
3. **Facade Pattern:** `QuozenAI` acts as the single unified entry point for clients, coordinating the `QuozenClient` (for context/mutations) with the `AiProvider` (for intelligence).  
4. **Adapter Pattern (Renaming):** Renaming the backend provider interface to `AiSdkAdapter` to disambiguate from the new client-side Core interface.

### **Diagrams**

sequenceDiagram

    participant UI as WebApp / CLI

    participant Facade as QuozenAI (Core)

    participant Factory as AiProviderFactory

    participant Provider as AiProvider (Strategy)

    participant QClient as QuozenClient (Core)

    participant Network as LLM / Proxy / Local

    

    UI-\>\>Factory: createProvider({ provider: 'auto', byok: '...' })

    Factory-\>\>Factory: Evaluate Fallback (BYOK \-\> Window \-\> TeamKey)

    Factory--\>\>UI: AiProvider Instance

    

    UI-\>\>Facade: new QuozenAI(quozenClient, aiProvider)

    UI-\>\>Facade: executeCommand("Split $50 lunch with Bob")

    

    Facade-\>\>QClient: Fetch Active Ledger & Members (RAG)

    QClient--\>\>Facade: Context Data

    Facade-\>\>Facade: Build System Prompt & Tool Schemas

    

    Facade-\>\>Provider: chat(messages, systemPrompt, tools)

    Provider-\>\>Network: Standardized HTTP/JS Request

    Network--\>\>Provider: JSON Response

    Provider--\>\>Facade: AgentChatResponse

    

    Facade-\>\>Facade: Validate Tool Call & Arguments

    Facade-\>\>QClient: ledger(id).addExpense(args)

    QClient--\>\>Facade: Success

    Facade--\>\>UI: { success: true, message: "..." }

## 2\. DATA MODEL & PERSISTENCE

This refactoring reorganizes runtime logic and does not require modifications to the underlying `quozen-settings.json` schema or Google Drive database definitions.

### **Configuration State (Runtime)**

The `AiProviderFactory` will consume a lightweight subset of the `UserSettings`:

export interface AiFactoryConfig {  
    providerPreference: 'auto' | 'byok' | 'local' | 'cloud' | 'disabled';  
    encryptedApiKey?: string;  
    baseUrl?: string; // e.g., Proxy URL or Ollama URL  
}

### **Caching Strategy**

* **Availability Check:** `AiProvider.checkAvailability()` will be called when the React app loads (via `AiFeatureProvider`) or when the CLI menu is accessed. Results are kept in volatile memory.

## 3\. API CONTRACTS (Interface Design)

We are strictly operating within the `@quozen/core` TypeScript environment. No new REST endpoints are added.

### **Core AI Interfaces (`packages/core/src/agent/providers/types.ts`)**

export interface AgentChatRequest {  
    messages: { role: string; content: string }\[\];  
    systemPrompt: string;  
    tools: any\[\];  
}

export interface AgentChatResponse {  
    type: 'text' | 'tool\_call';  
    content?: string;  
    tool?: string;  
    arguments?: any;  
    error?: string;  
}

export interface AiProvider {  
    readonly id: string;  
    chat(request: AgentChatRequest): Promise\<AgentChatResponse\>;  
    checkAvailability(): Promise\<boolean\>;  
    getSetupMessage(): string | null;  
}

## 4\. ENGINEER TASK BREAKDOWN

### **Phase 1: Backend Interface Disambiguation**

**Task [AI-01]: Rename Proxy Interfaces [DONE]**

* [x] In `apps/ai-proxy/src/providers/types.ts`, rename `AiProvider` to `AiSdkAdapter`.  
* [x] Update `google.ts`, `ollama.ts`, and `factory.ts` in the `apps/ai-proxy` to implement/use `AiSdkAdapter`.  
* [x] Ensure the proxy builds successfully (`npm run check --workspace=@quozen/ai-proxy`).

### **Phase 2: Core `AiProvider` Implementations**

**Task [CORE-01]: Define Core Interfaces & Factory [DONE]**

* [x] Create `packages/core/src/agent/providers/types.ts` defining `AiProvider`, `AgentChatRequest`, and `AgentChatResponse`.
* [x] Create `AiProviderFactory.ts` to resolve configurations.
* [x] `AiProviderFactory.createProvider(config)` correctly evaluates `"auto"` by checking if an API key exists (returns BYOK Proxy), checking if `window.ai` exists (returns Window), and finally falling back to the Proxy with no key (Team Key).

**Task [CORE-02]: Implement ProxyAiProvider [DONE]**

* [x] Create `packages/core/src/agent/providers/ProxyAiProvider.ts`.
* [x] `chat()` executes a standard `fetch` to the edge proxy.  
* [x] `checkAvailability()` fetches `/health` or `/` on the proxy.  
* [x] `getSetupMessage()` returns `null`. Uses standard Fetch API.

**Task [CORE-03]: Implement WindowAiProvider [DONE]**

* [x] Create `packages/core/src/agent/providers/WindowAiProvider.ts`.  
* [x] `chat()` formats the prompt with Few-Shot examples, invokes `window.ai.languageModel`, and parses the markdown JSON response.  
* [x] `checkAvailability()` checks `window?.ai?.languageModel?.capabilities().available === 'readily'`.  
* [x] `getSetupMessage()` returns instructions to enable Chrome Dev AI flags if unsupported.

**Task [CORE-04]: Implement LocalOllamaProvider [DONE]**

* [x] Create `packages/core/src/agent/providers/LocalOllamaProvider.ts`.  
* [x] `chat()` executes a `fetch` request mimicking OpenAI format directly to `http://localhost:11434/api/chat`.  
* [x] `checkAvailability()` fetches `/api/tags` and catches CORS/Connection errors safely.  
* [x] `getSetupMessage()` returns `"Note: Start Ollama with OLLAMA_ORIGINS=\"*\" ollama serve"`.

### **Phase 3: The `QuozenAI` Facade**

**Task [CORE-05]: Implement QuozenAI Facade [DONE]**

* [x] Create `packages/core/src/agent/QuozenAI.ts`.  
* [x] The class accepts a `QuozenClient` instance and an `AiProvider`.
* [x] Exposes an `executeCommand(prompt: string, activeGroupId: string)` method. Internally, this method:  
  1. Fetches the Ledger via `QuozenClient`.  
  2. Uses `AgentOrchestrator.buildSystemPrompt`.  
  3. Invokes `AiProvider.chat()`.  
  4. Validates the output.  
  5. Executes `quozen.ledger(groupId).addExpense(...)` or `addSettlement(...)`.  
  6. Returns a standardized `{ success: boolean, message: string }` object.

### **Phase 4: WebApp Refactoring**

**Task [WEB-01]: Refactor AiFeatureProvider [DONE]**

* [x] Remove the hardcoded `fetch` logic from `apps/webapp/src/features/agent/AiFeatureProvider.tsx`.  
* [x] The provider instantiates the `AiProviderFactory`, calls `.checkAvailability()` on the resolved strategy, and sets context status appropriately.

**Task [WEB-02]: Refactor useAgent.ts [DONE]**

* [x] Rip out the execution, routing, and JSON parsing logic from the React hook.  
* [x] The hook resolves the active `AiProvider`, instantiates `new QuozenAI(quozenClient, provider)`, calls `.executeCommand()`, triggers the React Query invalidations, and fires the success/error Toasts.

**Task [WEB-03]: Update Profile Settings UI [DONE]**

* [x] Update `apps/webapp/src/pages/profile.tsx` to dynamically render setup messages.  
* [x] When a user selects a provider from the dropdown, it calls `AiProviderFactory.getSetupMessage(provider)` and displays the helper text below the select box.
* [x] Ensure "Team Key" is not an explicitly selectable option.

### **Phase 5: CLI Integration**

**Task [CLI-01]: Extend Interactive Menu with "Ask AI" [DONE]**

* [x] Update `apps/cli/src/interactive.ts` to consume the new core capabilities.  
* [x] The main menu includes a new option: `Ask AI`.  
* [x] When selected, prompt the user for text input.  
* [x] Instantiate `QuozenAI` using the `AiProviderFactory` (which defaults to Proxy Team Key fallback).  
* [x] Call `executeCommand`.  
* [x] Print the resulting success or error message using `chalk` for terminal styling.

### **Phase 6: Configuration & Documentation**

**Task \[CONFIG-01\]: Standardize Environment Configurations [DONE]**

* [x] Update the example environment files across the monorepo.
* [x] Update root `.env.example` with `VITE_DISABLE_AI` and `VITE_AI_PROXY_URL`.
* [x] Update `apps/ai-proxy/example.dev.vars` with Ollama overrides.
* [x] Audit `package.json` scripts.

**Task \[DOC-01\]: Update Monorepo `README.md` (AI Capabilities & Architecture) [DONE]**

* [x] Expand central documentation for Strategy/Factory pattern.
* [x] Added "Agentic UI & Polymorphic Providers" section to `README.md`.

**Task \[DOC-02\]: Document Local AI Setup Requirements (Chrome & Ollama) [DONE]**

* [x] Provide instructions for Chrome `window.ai` and Ollama setup.


---

### **Note for developers:**

We highly recommend having the engineer tackle **\[CONFIG-01\]** concurrently with **Phase 1**, as having the environment variables straight from day one prevents painful debugging later. The **\[DOC-01\]** and **\[DOC-02\]** tasks should be the final gate checks before the Pull Request is merged.

## 5\. Technical Debt Fixes and Testing Tasks (for software engineers to implement)

### **1\. Architectural Decision: Remove `interactive.ts`**

**Decision:** Delete `apps/ai-proxy/scripts/interactive.ts`. **Rationale:** 1\. **DRY Principle:** We do not want to maintain two separate CLI REPLs. 2\. **Fidelity:** The new `@quozen/cli` "Ask AI" feature provides a much higher fidelity test. It exercises the actual `@quozen/core` data fetching, the real RAG builder, the Polymorphic Provider routing, *and* the proxy all at once. The old script bypassed the core SDK entirely.

---

### **2\. Unit Testing Strategy**

With the logic moving out of the React components and into the Core, our testing focus shifts heavily to `@quozen/core`.

* **`@quozen/core` (High Priority):** Needs rigorous testing of the `AiProviderFactory` (the "Auto" fallback waterfall is critical to get right), the parsing logic of `WindowAiProvider` (stripping Markdown from local LLM JSON outputs), and the end-to-end orchestration inside the `QuozenAI` facade.  
* **`@quozen/webapp` (Medium Priority):** The React tests will shrink. We just need to verify that `useAgent.ts` properly wires the UI toasts and React Query invalidations to the Facade's output, and that `AiFeatureProvider` correctly reads from `provider.checkAvailability()`.  
* **`@quozen/ai-proxy` (Low/Maintenance Priority):** The existing `proxy.test.ts` handles the Hono routing and KMS well. We just need to ensure the new `ProviderFactory` (Google vs. Ollama) is covered.  
* **Unit Tests (CI-Safe):** All core logic, routing, and factory resolution tests must use **Mocks** (e.g., mocking `fetch`, `window.ai`, or `AiProvider.chat()`). These must run instantly and unconditionally in all environments.  
* **Live Integration Tests (Local Only):** Any test that requires generating real tokens or evaluating actual LLM outputs must be strictly gated.  
  * **Engine:** They must *only* target the local Ollama provider to guarantee zero cost and high privacy.  
  * **Execution Gate:** They must be conditionally skipped if running in a CI/CD environment (e.g., `process.env.CI === 'true'`) or if a specific opt-in flag is missing. We will use Vitest's `describe.runIf()` or `describe.skipIf()` feature to enforce this.

---

### **3\. ENGINEER TASK BREAKDOWN: Testing & Cleanup Phase**

I have formalized these into tasks so the engineering team can execute them alongside the refactoring.

**Task \[CLEANUP-01\]: Remove Legacy Proxy Interactive Script [DONE]**

* [x] Delete `apps/ai-proxy/scripts/interactive.ts`.  
* [x] Remove scripts from `package.json`.
* [x] Update `apps/ai-proxy/README.md`.

**Task \[TEST-01\]: Core Unit Tests \- `AiProviderFactory` & Providers [DONE]**

* [x] Write isolated tests for polymorphic providers in `packages/core/tests/agent/`.  
* [x] Verify Factory waterfall: BYOK \-\> Window \-\> Team Key.

**Task \[TEST-02\]: Core Unit Tests \- `QuozenAI` Facade [DONE]**

* [x] Created `packages/core/tests/agent/QuozenAI.test.ts`.  
* [x] Verified tool call execution and error handling.

**Task \[TEST-03\]: Webapp Unit Tests \- Refactored Hooks [DONE]**

* [x] Updated `useAgent.test.tsx` to spy on `QuozenAI`.

**Task \[TEST-04\]: AI Proxy Unit Tests \- Provider Factory [DONE]**

* [x] Validated factory correctly toggles adapters.

**Task \[TEST-05\]: Live Ollama Integration Tests (Local Only) [DONE]**

* [x] Created `packages/core/tests/agent/live-integration.test.ts`.  
* [x] Verified tool extraction from real model (skipped in CI).

**Task \[CONFIG-02\]: Configure NPM Scripts for Live Testing [DONE]**

* [x] Added `"test:ai:live"` to root `package.json`.


---

### **4\. Implementation Example (For the Engineer)**

To ensure the engineer implements the skip logic correctly, they should use this Vitest pattern in `live-integration.test.ts`:

import { describe, it, expect } from 'vitest';

import { QuozenAI, LocalOllamaProvider } from '../../src';

// This completely skips the suite in CI environments (GitHub Actions, Vercel) 

// or if the developer hasn't explicitly opted in.

const shouldRun \= \!process.env.CI && process.env.RUN\_LOCAL\_LLM\_TESTS \=== 'true';

describe.runIf(shouldRun)('Live Ollama Integration Tests', () \=\> {

    it('should correctly extract an addExpense tool call from a real local model', async () \=\> {

        // Setup local provider and facade

        const provider \= new LocalOllamaProvider({ baseUrl: 'http://localhost:11434/api' });

        

        // Ensure Ollama is actually running before proceeding

        const isAvailable \= await provider.checkAvailability();

        expect(isAvailable).toBe(true);

        // ... execute real test ...

    });

});

