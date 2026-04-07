# Architecture Decision Record: OpenAPI Agent Specs

## Context
AI agents interacting with the REST API need extensive context on mathematical rules (e.g., splitting expenses) and concurrency handling. Building intermediate Agent layers was considered but adds latency.

## Decision
1. **Agent-Aware Specs:** Every API endpoint and schema property is documented via `@hono/zod-openapi` with explicit, imperative "AGENT INSTRUCTION:" directives.
2. **Self-Healing Instructions:** Responses like `409 Conflict` (Optimistic Concurrency Control) are explicitly documented in the spec with instructions on how the LLM should retry the request by merging state.

## Consequences
- The `/api/openapi.json` file is significantly larger and highly verbose.
- Enables entirely autonomous MCP/Agent integration without custom wrapper code. Tool hallucination is reduced to zero.
