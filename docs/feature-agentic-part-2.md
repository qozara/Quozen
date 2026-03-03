# **1\.  Agentic UI Feature optionality  \- HIGH-LEVEL ARCHITECTURE**

### **System Context**

Currently, the AI feature is conditionally rendered based purely on user settings, assuming the infrastructure is always available. This refactoring introduces a **Pre-flight Capability Check** pattern. The `AiFeatureProvider` will act as a strict gateway, performing an asynchronous health and configuration check exactly once during app startup. It will expose a React Context (`AiFeatureContext`) so that UI components (like the Profile page) can gracefully adapt their rendering based on the actual availability of the AI infrastructure, rather than assuming it works.

### **Design Patterns**

1. **Pre-flight Check Pattern:** A startup routine that validates environment variables, build flags, and network availability before enabling a subsystem.  
2. **Context/Provider Pattern:** Encapsulates the async state (`checking`, `available`, `unavailable`) and broadcasts it to the DOM tree to prevent prop-drilling.  
3. **Error Boundary (Fallback) Pattern:** Wraps the `React.lazy()` import. If the chunk fails to load (e.g., due to a network drop or bad deployment), the Error Boundary catches the failure, updates the context to `unavailable`, and prevents a white screen of death.

### **Diagrams**

sequenceDiagram  
    participant App as WebApp Root  
    participant Provider as AiFeatureProvider  
    participant Context as AiFeatureContext  
    participant Proxy as Edge AI Proxy  
    participant Profile as Profile UI  
    participant Header as Header Slot

    App-\>\>Provider: Mounts on Startup  
    Provider-\>\>Provider: 1\. Check VITE\_DISABLE\_AI build flag  
    alt Flag is true  
        Provider-\>\>Context: status \= 'unavailable' (Reason: Build flag)  
    else Flag is false  
        Provider-\>\>Provider: 2\. Check VITE\_AI\_PROXY\_URL env var  
        alt Env Var Missing  
            Provider-\>\>Context: status \= 'unavailable' (Reason: Missing Env Var)  
        else Env Var Present  
            Provider-\>\>Proxy: 3\. GET / (Timeout: 3000ms)  
            alt Network Error / Timeout  
                Proxy--\>\>Provider: Fetch Failed  
                Provider-\>\>Context: status \= 'unavailable' (Reason: Proxy Unreachable)  
            else 200 OK  
                Proxy--\>\>Provider: Proxy is Running  
                Provider-\>\>Context: status \= 'available'  
            end  
        end  
    end

    Provider-\>\>Provider: console.info(Reason) if unavailable

    alt is available  
        Provider-\>\>Provider: Render \<Suspense\>\<AgentModule /\>\</Suspense\>  
        Provider-\>\>Header: Portal Sparkle Icon  
        Profile-\>\>Context: Read status  
        Profile-\>\>Profile: Render AI Settings Dropdowns  
    else is unavailable  
        Provider-\>\>Provider: Do not load AgentModule  
        Profile-\>\>Context: Read status  
        Profile-\>\>Profile: Hide Dropdowns, show "AI features not available"  
    end

# **2\. DATA MODEL & PERSISTENCE**

This refactoring is purely client-side runtime state. No database or `quozen-settings.json` schema changes are required.

### **State Structure (Runtime Context)**

We will create a new context interface `AiFeatureState` to manage the lifecycle in memory.

export type AiAvailabilityStatus \= 'checking' | 'available' | 'unavailable';

export interface AiFeatureState {  
    status: AiAvailabilityStatus;  
    reason?: string; // Strictly for debugging/console logging  
}

### **Caching Strategy**

* **Network Check:** The `fetch` call to the proxy's health endpoint (`/`) will be executed exactly once when `AiFeatureProvider` mounts. No polling or intervals will be implemented.  
* **Persistence:** We will *not* persist this availability status to `localStorage`. Infrastructure health is transient and must be re-evaluated on every fresh app load.

# **3\. API CONTRACTS (Interface Design)**

We will utilize the existing root endpoint of `apps/ai-proxy` as our health check.

**Method/Route:** `GET /` (against `VITE_AI_PROXY_URL`)

* **Request Headers:** None required (unauthenticated health check).  
* **Expected Response:** `200 OK` (Text: "Quozen AI Proxy is Running")  
* **Client Handling constraints:** The client `fetch` call must include an `AbortSignal` with a strict timeout (e.g., 3 seconds) to ensure the app doesn't hang in a "checking" state if the edge network drops the packet.

# **4\. ENGINEER TASK BREAKDOWN**

### **Frontend (WebApp) Tasks**

**Task \[FE-01\]: Implement `AiFeatureContext` and Hook [DONE]**

* **Description:** Create `apps/webapp/src/features/agent/AiFeatureContext.tsx`. Define the `AiFeatureState` interface and a `useAiFeature` hook. Provide a default context value of `{ status: 'checking' }`.  
* **Technical Definition of Done:** Hook is exported and throws an error if used outside of the provider.

**Task \[FE-02\]: Implement Startup Pre-flight Checks in Provider [DONE]**

* **Description:** Refactor `apps/webapp/src/features/agent/AiFeatureProvider.tsx`.  
  * Add a `useEffect` with an empty dependency array `[]`.  
  * **Step 1:** Check if `import.meta.env.VITE_DISABLE_AI === 'true'`. If so, set status to `unavailable` and reason to `"Disabled via build configuration"`.  
  * **Step 2:** Check if `import.meta.env.VITE_AI_PROXY_URL` exists. If not, set status to `unavailable` and reason to `"Missing proxy URL in environment"`.  
  * **Step 3:** Perform a `fetch(VITE_AI_PROXY_URL)` using `AbortController` with a 3000ms timeout.  
  * **Step 4:** If the fetch fails or times out, set status to `unavailable` and reason to `"Proxy unreachable or timeout"`. Otherwise, set to `available`.  
  * **Step 5:** `console.info("[Agentic UI] Disabled:", reason)` if unavailable.  
* **Technical Definition of Done:** The context correctly holds `available` or `unavailable` after the initial render cycle. No polling is introduced.

**Task \[FE-03\]: Implement Lazy Load Error Boundary [DONE]**

* **Description:** Create a local `AiErrorBoundary` component within `AiFeatureProvider.tsx` that catches rendering errors from the `React.lazy()` load of `AgentModule`.  
* **Technical Definition of Done:** If `AgentModule` fails to download (e.g., chunk load error), the Error Boundary catches it, gracefully sets the context status to `unavailable` (reason: `"Module load failure"`), and returns `null` (rendering nothing).

**Task \[FE-04\]: Refactor Profile Page UI [DONE]**

* **Description:** Update `apps/webapp/src/pages/profile.tsx` to consume `useAiFeature()`.  
  * If `status === 'checking'`, render a skeleton loader in the AI Assistant card.  
  * If `status === 'unavailable'`, hide the Provider/API Key dropdown inputs completely and render a muted paragraph: *"AI features are currently not available."*  
  * Ensure the card header (Sparkles icon and "AI Assistant" title) remains visible to provide context.  
* **Technical Definition of Done:** Users cannot interact with or view AI settings when the subsystem is disabled.

**Task \[FE-05\]: Cleanup Trigger Logic [DONE]**

* **Description:** Ensure that `AiFeatureProvider.tsx` conditionally renders `<Suspense><AgentModule /></Suspense>` *only* if `status === 'available'`.  
* **Technical Definition of Done:** Since `AgentModule` is responsible for portaling the Sparkle icon into the header (`#header-actions-slot`), preventing its render automatically satisfies the requirement to hide the icon in the upper right corner. No changes to `header.tsx` are required.
