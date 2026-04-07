# Architecture Decision Record: Hybrid Agentic UI

## Context
Quozen required a natural language agent integrated into the WebApp. Relying entirely on a centralized cloud LLM proxy would introduce high hosting costs and potential privacy concerns. 

## Decision
1. **Hybrid Execution Model**: The Client-Side application orchestrates the RAG context and explicitly calls an `AiProvider`. It supports:
   - **Local AI:** Chrome's `window.ai` API.
   - **Bring Your Own Key (BYOK):** Keys encrypted via an Edge KMS (`apps/ai-proxy/encrypt`) and saved securely to Drive.
   - **Cloud Proxy:** Developer-hosted fallback with strict Vercel KV rate limits.
   - **LocalHost Ollama:** Power users can direct requests manually to `localhost:11434`.
2. **Lazy Loaded Isolation:** To protect payload size, the AI module is lazy-loaded (`React.lazy`) and evaluated via a `Pre-flight Capability Check Pattern` at startup. If disabled or unavailable, the main bundle remains completely untouched.

## Consequences
- The `ai-proxy` only acts as a stateless text-in/JSON-out routing and KMS layer; actual state is built client-side.
- Infinite scalability per user since execution runs in their browser or via their personal keys.
