# Architecture Decision Record: AI Core Orchestration

## Context
Agent orchestration was duplicated across the WebApp and CLI. RAG context building, JSON parsing, and fallback evaluation needed standardizing.

## Decision
1. **Core Relocation:** AI orchestrator removed from React and moved to `@quozen/core`.
2. **`QuozenAI` Facade:** Provides a unified `.executeCommand(prompt)` method combining the `QuozenClient` state mapped dynamically to tool schemas for an `AiProvider`.
3. **`AiProviderFactory` Auto-Fallback:** Determines which `AiProvider` to use by evaluating available tokens, `window.ai` presence, or network health. 

## Consequences
- Perfect parity between App and CLI AI logic.
- The React application code shrinks, acting only as a UI wrapper fetching contexts and displaying status strings.
