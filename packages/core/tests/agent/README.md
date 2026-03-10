
# **📐  AI Testing Taxonomy Improvements**

To achieve a full, extensible suite, we have restructured the tests into three distinct tiers:

#### **Tier 1: Pure Unit Tests (Fast, No LLM, No Network)**

* **Goal:** Verify the internal logic, error catching, and routing of the Quozen AI modules.  
* **Files:** 
  * `AiProviderFactory.test.ts`  
  * `QuozenAI.unit.test.ts` *(Renamed)*: We mock the LLM to return garbage data, missing parameters, and unsupported tools to ensure our core never crashes.

#### **Tier 2: The LLM Intelligence Matrix (Live LLM \+ InMemory Storage)**
This tier runs with root package script goal "test:ai:live"

* **Goal:** Evaluate the chosen LLM's ability to extract intent and pick the right tools from natural language, using the blazing-fast `InMemoryAdapter`.  
* **File:** `llm-behavior.test.ts` *(Renamed from `live-ollama-memory`)*  
* **Architecture:** We will build a data-driven test array (a matrix). This makes it trivial to add new features later. We will test:  
  1. **Expense Creation:** (e.g., "Add $50 for gas", "I paid $100 for dinner")  
  2. **Settlement Creation:** (e.g., "I just paid Alice $20", "Record that Bob gave me $50 in cash")  
  3. **Language Support:** (e.g., "Agrega 50 de gastos...", "Pagué 20 a Juan")  
  4. **Out-of-Bounds Rejection:** (e.g., "What is the capital of France?", "Delete the group") \-\> *Ensure the LLM safely refuses to answer or triggers the fallback message.*

#### **Tier 3: E2E Infrastructure Smoke Test (Live LLM \+ Proxy \+ Real Drive)**
This tier runs with root package script goal "test:ai:live"

* **Goal:** Prove the physical network architecture works without getting rate-limited by Google.  
* **File:** `infrastructure-smoke.test.ts` *(Renamed from `live-proxy-drive`)*  
* **Architecture:** A single test block that creates a real group, asks the AI to add an expense, asks the AI to settle the debt, verifies the real Google Sheet balances are $0.00, and deletes the group.