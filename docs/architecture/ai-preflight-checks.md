# AI Pre-flight & Availability Architecture

## Overview

Quozen's command input is **offline-first and deterministic**. The quick command bar (`AgentTrigger`) is always active and available on device for local parsing via `StandardCommandParser`, even if AI features are disabled, unreachable, or the device is completely offline.

AI pre-flight checks govern **optional cloud/local LLM escalation** (such as "Refine with AI", OCR bill scanning, or custom BYOK keys) without blocking core user interactions.

## Privacy & Zero-Localhost Probing Guarantee

To prevent browser security warnings (Private Network Access popups when querying `localhost`), Quozen guarantees:
- **No Automatic Localhost Probing**: Quozen will **never** attempt to connect to `http://localhost:11434` (Ollama) unless the user explicitly enables **"Allow Local Network Access (Ollama)"** (`enableLocalAi: true`) under **Profile > AI Assistant**.
- **Safe Automatic Waterfall**: When `enableLocalAi` is false (default), the auto-resolution waterfall checks purely in-process or remote endpoints: BYOK Key -> `window.ai` (in-process Gemini Nano) -> Cloud Proxy (`https://ai.qozara.org`).

## Resolution Flow

```mermaid
sequenceDiagram
    participant App as WebApp Root
    participant Provider as AiFeatureProvider
    participant Context as AiFeatureContext
    participant Settings as UserSettings (RxDB)
    participant Header as Header Agent Trigger

    App->>Provider: Mounts on Startup
    Provider->>Settings: Read preferences (enableLocalAi, aiProvider, keys)
    
    %% Deterministic command bar is ALWAYS available
    Provider->>Header: Mount Command Trigger (Offline-ready, Deterministic)
    
    %% Optional AI Escalation Readiness Check
    alt VITE_DISABLE_AI is true or aiProvider is 'disabled'
        Provider->>Context: status = 'unavailable'
    else enableLocalAi is false (Default)
        Provider->>Context: Safe Cloud/WindowAI Mode (Zero localhost requests)
    else enableLocalAi is true (User opted-in)
        Provider->>Provider: Allow Local Ollama resolution (localhost:11434)
    end
```
