### **1\. THE EPIC**

**Title:** AI Configuration Decoupling & Advanced Provider Settings **Description:** Refactor the AI settings interface in the user profile to be permanently accessible, decoupling it from the global AI health status. Introduce granular configuration fields for specific AI providers (e.g., Local Ollama URLs and Models). This empowers users to troubleshoot and configure their AI experience without being locked out by failing initial health checks, while providing real-time connection validation upon saving. **Success Metrics:**

* **Accessibility:** 0% of users are locked out of the AI settings UI due to unreachable providers or initial load failures.  
* **Configuration Success:** 100% of custom configurations (Ollama URL/Model) are successfully persisted to `quozen-settings.json`.  
* **User Feedback:** Connection health checks resolve and display clear UI toast notifications (Success/Warning) within 3 seconds of saving.

---

### **2\. SCOPE & CONSTRAINTS (For the Architect)**

**In-Scope:**

* Removing the conditional rendering logic in `src/pages/profile.tsx` that hides AI settings when `status === 'unavailable'`.  
* Updating the `UserSettings` schema in `@quozen/core` to support new optional plain-text fields: `ollamaBaseUrl` and `ollamaModel`.  
* Implementing dynamic UI fields that appear based on the selected AI provider (e.g., BYOK vs. Local Ollama).  
* Implementing a "Permissive Save with Validation" flow: checking provider health upon saving, showing the result, but persisting the settings regardless of the health check outcome.  
* Displaying `import.meta.env` default values as HTML `placeholder` attributes for empty custom fields.

**Out-of-Scope:**

* Encrypting the Ollama Base URL or Model Name via Edge KMS (plain text storage is accepted).  
* Changing the underlying AI routing logic (the "Auto" waterfall remains unchanged).  
* Exposing the "Team Key" (Cloud Proxy) as a manually selectable option in the provider dropdown.  
* Modifying the Vercel Edge Proxy backend logic.

**Technical Dependencies:**

* Requires updates to `@quozen/core` domain models (`UserSettings`).  
* Requires the `AiProvider.checkAvailability()` method to be invoked dynamically with draft state during the save action.

**NFRs (Non-Functional Requirements):**

* **Performance / Latency:** The real-time health check triggered during the "Save" action must have a strict timeout (e.g., 3000ms) to prevent the UI from hanging if a local Ollama instance drops packets.  
* **Reliability:** The UI must cleanly catch and handle CORS errors or `TypeError: Failed to fetch` exceptions during local Ollama checks without crashing the React tree.

---

### **3\. USER STORIES (For the Engineers)**

**US-101: Always-Visible AI Settings Panel**

* **Narrative:** As a User, I want the AI settings panel to always be visible and interactive, So that I can change my provider or fix my configuration even if the current setup is broken.  
* **Acceptance Criteria:**  
  * **Scenario 1 (Broken Initial State):** Given the global AI status evaluates to `unavailable` on load, When I navigate to the Profile page, Then the AI Provider dropdown and configuration inputs remain fully visible and interactive instead of displaying a disabled message.  
  * **Scenario 2 (Dynamic Field Display):** Given I interact with the Provider dropdown, When I select a specific provider, Then the UI dynamically displays only the relevant configuration fields for that selection (e.g., API Key for BYOK; URL/Model for Ollama).  
* **Dev Notes:** Remove the `aiStatus === 'unavailable'` ternary branch in `profile.tsx` that replaces the form with the "AI features are currently not available" text. Ensure the "Team Key" option is explicitly excluded from the dropdown options.

**US-102: Local Ollama Configuration Fields**

* **Narrative:** As a Power User, I want to define my own Ollama Base URL and Model Name, So that I can connect the Quozen client to a custom local or network-hosted LLM instance.  
* **Acceptance Criteria:**  
  * **Scenario 1 (Placeholders):** Given I select "Local Ollama" from the provider dropdown, When the input fields render, Then the `Base URL` and `Model` inputs display the system default environment variables (e.g., `VITE_OLLAMA_URL`) as grayed-out placeholders.  
  * **Scenario 2 (Persistence):** Given I enter a custom URL and Model, When I save the profile, Then the values are stored in plain text inside `quozen-settings.json` under `preferences.ollamaBaseUrl` and `preferences.ollamaModel`.  
* **Dev Notes:** Update the `@quozen/core` `UserSettings` interface. Ensure the frontend gracefully falls back to the environment variables in `AiProviderFactory.createProvider` if the user leaves these fields blank.

**US-103: Real-Time Connection Validation & Permissive Saving**

* **Narrative:** As a User configuring an AI provider, I want the system to test my connection when I hit save but not block the save if it fails, So that I get immediate feedback but can still persist settings while I troubleshoot my local server or network.  
* **Acceptance Criteria:**  
  * **Scenario 1 (Healthy Connection):** Given I enter a valid BYOK key or active Ollama URL, When I click Save, Then the app pings the provider, validates the connection, saves the settings to Google Drive, and displays a "Connection Successful & Saved" toast.  
  * **Scenario 2 (Unreachable Provider):** Given I enter an offline Ollama URL, When I click Save, Then the app attempts the ping, catches the timeout/error, saves the configuration to Google Drive anyway, and displays a warning toast (e.g., "Settings saved, but provider is unreachable. Check your server.").  
* **Dev Notes:** In the save handler, instantiate a temporary provider instance using `AiProviderFactory.createProvider` with the *draft* state from the form. Call `await tempProvider.checkAvailability()` before executing the `updateSettings` mutation. Ensure the UI button shows a loading spinner during this verification phase.

# Architecture Review and Tasks breakdown (For the Software Engineer to implement)

Here is the Technical Design Document for the **AI Configuration Decoupling & Advanced Provider Settings** epic.

### **1\. HIGH-LEVEL ARCHITECTURE**

**System Context** Currently, the Quozen WebApp locks users out of the AI settings in the Profile page if the initial `AiFeatureProvider` health check evaluates to `unavailable`. This creates a catch-22: users cannot fix a broken Local Ollama configuration because the broken configuration hides the UI required to fix it.

This redesign decouples the Profile UI from the global AI health status. It introduces a "Draft-Validate-Persist" flow where users can dynamically configure provider-specific settings (like custom Ollama URLs/Models), validate the connection on the fly, and permissively save the settings to Google Drive (`quozen-settings.json`) even if the provider is currently unreachable.

**Design Patterns**

1. **Draft-Validate-Persist Pattern:** The UI maintains a local draft of the AI configuration. Upon saving, it instantiates a temporary provider, validates it, and persists the configuration regardless of the health check outcome, providing immediate UX feedback.  
2. **Factory Pattern (Reuse):** We will leverage the existing `AiProviderFactory.createProvider` to instantiate the temporary validation instance without polluting the global application state.  
3. **Graceful Degradation:** The UI will seamlessly fall back to environment variables (`import.meta.env`) if the user clears their custom plain-text configuration fields.

**Sequence Diagram: Permissive Save & Validation Flow**

sequenceDiagram

    participant User

    participant ProfileUI as Profile Page (React)

    participant Factory as AiProviderFactory

    participant Provider as Temporary AiProvider

    participant SettingsHook as useSettings()

    participant Toast as Toast Notification

    User-\>\>ProfileUI: Selects "Local Ollama" & Enters Custom URL

    User-\>\>ProfileUI: Clicks "Save Settings"

    

    ProfileUI-\>\>ProfileUI: Set isVerifying \= true

    

    ProfileUI-\>\>Factory: createProvider({ providerPreference: 'local', baseUrl: customUrl, ... })

    Factory--\>\>ProfileUI: tempProviderInstance

    

    ProfileUI-\>\>Provider: checkAvailability()

    

    alt Provider is Reachable

        Provider--\>\>ProfileUI: true

        ProfileUI-\>\>SettingsHook: updateSettings({ ...draftSettings })

        SettingsHook--\>\>ProfileUI: Success

        ProfileUI-\>\>Toast: "Connection Successful & Settings Saved" (Success)

    else Provider is Unreachable (Timeout/CORS)

        Provider--\>\>ProfileUI: false

        ProfileUI-\>\>SettingsHook: updateSettings({ ...draftSettings })

        SettingsHook--\>\>ProfileUI: Success

        ProfileUI-\>\>Toast: "Settings saved, but provider is unreachable." (Warning)

    end

    

    ProfileUI-\>\>ProfileUI: Set isVerifying \= false

### **2\. DATA MODEL & PERSISTENCE**

Because Quozen uses Google Drive as a serverless database, schema changes occur within the TypeScript interfaces that map to `quozen-settings.json`.

**Schema Changes** Update `packages/core/src/domain/models.ts`:

export interface UserSettings {

    // ... existing fields

    preferences: {

        defaultCurrency: string;

        theme?: "light" | "dark" | "system";

        locale?: "en" | "es" | "system";

        aiProvider?: "auto" | "byok" | "local" | "cloud" | "disabled";

        // NEW FIELDS

        ollamaBaseUrl?: string; // Plain text

        ollamaModel?: string;   // Plain text

    };

    encryptedApiKey?: string;

    // ...

}

**Configuration Hydration** Update `packages/core/src/agent/providers/types.ts` to ensure `AiFactoryConfig` explicitly maps these new fields:

export interface AiFactoryConfig {  
    providerPreference: 'auto' | 'byok' | 'local' | 'cloud' | 'disabled';  
    encryptedApiKey?: string;  
    baseUrl?: string;     // Maps to preferences.ollamaBaseUrl || env.VITE\_OLLAMA\_URL  
    ollamaModel?: string; // Maps to preferences.ollamaModel || env.VITE\_OLLAMA\_MODEL  
    proxyUrl?: string;  
}

**Caching & Security Strategy**

* **Security:** The Ollama Base URL and Model Name do not contain sensitive secrets and will be stored in plain text within `quozen-settings.json`. The BYOK API key will remain strictly encrypted via the Edge KMS.  
* **Caching:** The UI will read from the React Query cache (`['drive', 'settings']`). Updates will immediately mutate this cache and write-through to Google Drive.

---

### **3\. API CONTRACTS (Interface Design)**

No external REST API changes are required. The contract updates are strictly internal to the `@quozen/core` SDK.

**Internal SDK Contract Update: `AiProviderFactory.createProvider`**

* **Input:** `AiFactoryConfig` must now reliably receive the user's custom Ollama overrides from `settings.preferences` instead of relying solely on hardcoded environment variables during instantiation in `useAgent.ts` and the `Profile` page.  
* **Behavior:** The factory logic remains unchanged; it simply consumes the provided `baseUrl` and `ollamaModel` parameters when instantiating the `LocalOllamaProvider`.

---

### **4\. ENGINEER TASK BREAKDOWN**

**Task \[CORE-01\]: Update Domain Models & Factory Interfaces** [DONE]

* **Description:** 1\. Update the `UserSettings` interface in `packages/core/src/domain/models.ts` to include `ollamaBaseUrl?: string` and `ollamaModel?: string` under the `preferences` object. 2\. Ensure `apps/webapp/src/features/agent/AiFeatureProvider.tsx` and `useAgent.ts` pass these new preference fields into `AiProviderFactory.createProvider` as `baseUrl` and `ollamaModel`, falling back to `import.meta.env` values if they are undefined or empty strings.  
* **Technical Definition of Done:** The TypeScript compiler passes, and the core package supports the new configuration fields.

**Task \[FE-01\]: Always-Visible AI Settings Panel** [DONE]


* **Description:** In `apps/webapp/src/pages/profile.tsx`, remove the conditional rendering block that checks if `aiStatus === 'unavailable'`. The AI Provider `<Select>` dropdown and its child configurations must always render, regardless of the global `AiFeatureContext` status. Ensure the "Team Key" (Cloud Proxy) option is not manually selectable in the `<Select>` component.  
* **Technical Definition of Done:** Users can view and interact with the AI provider dropdown even if the initial load evaluates the AI as unavailable.

**Task \[FE-02\]: Local Ollama Configuration UI** [DONE]


* **Description:** In `apps/webapp/src/pages/profile.tsx`, add a new conditional rendering block: if `settings?.preferences?.aiProvider === 'local'`, display two new `<Input>` fields for "Ollama Base URL" and "Ollama Model".  
  * Bind their values to local React state (draft state).  
  * Set their `placeholder` attributes to `import.meta.env.VITE_OLLAMA_URL` and `import.meta.env.VITE_OLLAMA_MODEL` respectively.  
* **Technical Definition of Done:** The inputs correctly appear only when "Local Chrome AI" (or "Local Ollama") is selected, and draft state is managed locally in the component.

**Task \[FE-03\]: Real-Time Validation & Permissive Saving** [DONE]

* **Description:** In `apps/webapp/src/pages/profile.tsx`, implement a new `handleSaveAiSettings` function (triggered by a "Save AI Settings" button).  
  1. Set a local `isVerifying` loading state to true.  
  2. Construct an `AiFactoryConfig` object using the draft state (provider, custom url, custom model, or encrypted key).  
  3. Instantiate a temporary provider using `AiProviderFactory.createProvider()`.  
  4. Call `await tempProvider.checkAvailability()`.  
  5. Call `updateSettings` to persist the draft state to `quozen-settings.json` **regardless of the availability check result**.  
  6. If availability is `true`, fire a success toast ("Connection Successful & Settings Saved"). If `false`, fire a warning/destructive toast ("Settings saved, but provider is unreachable").  
  7. Set `isVerifying` to false.  
* **Technical Definition of Done:** The user receives immediate health check feedback upon saving, but the settings are successfully persisted to the backend even if the check fails. All CORS/Network errors during the check are caught cleanly without crashing the app.

