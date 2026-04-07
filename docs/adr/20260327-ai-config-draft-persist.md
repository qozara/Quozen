# Architecture Decision Record: AI Provider Configuration (Draft-Validate-Persist)

## Context
Users encountered "catch-22" scenarios where a broken AI configuration (e.g., an offline Ollama server) triggered a pre-flight health failure, resulting in the Settings UI being unrendered/disabled, blocking them from fixing the URL.

## Decision
1. **Always-Visible UI:** The AI Settings inputs are decoupled from the global `AiFeatureProvider` health check status and remain interactable.
2. **Draft-Validate-Persist Flow:** The UI intercepts the "Save" action, creates a temporary `AiProvider` dynamically configured by the uncommitted text fields, executes the health check async, and immediately commits to `Google Drive`.
3. **Permissive Saving:** Even if the health check fails (e.g., timeout), the configuration is still written to the Google Drive cache. A UI toast indicates "Settings saved, but provider is unreachable".

## Consequences
- Resolves "locked-out" states.
- Ensures offline or lagging custom endpoints can still be persisted.
