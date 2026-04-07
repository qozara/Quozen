# Architecture Decision Record: Edge REST API (OpenAPI 3.0)

## Context
To enable AI Agents (via MCP or OpenAI functions) to interact with Quozen without building custom web-scraping logic, a programmatic REST API was required. It needed to be highly available, fast, and zero-maintenance infrastructure.

## Decision
1. **Edge Deployment:** We build the API using **Hono**, deploying natively to **Cloudflare Workers / Vercel Edge**. The API is strictly stateless.
2. **Schema-Driven API (`@hono/zod-openapi`):** Input/output validations are powered by Zod schemas, ensuring total runtime safety and automatic generation of the OpenAPI specification.
3. **Middleware Dependency Injection:** An Auth middleware extracts the Google OAuth Bearer token, fetches Google user info, instantiates the `@quozen/core` `QuozenClient` per-request, and injects it into the Hono context.
4. **Mocked Environments:** The API uses an `InMemoryAdapter` and specific `TEST_TOKEN` bypass logic during the CI pipeline to run sub-second, full-coverage tests without real network calls.

## Consequences
- Every API request incurs a Google Identity `userinfo` validation call to authenticate.
- Since it's stateless, the QuozenClient's internal cache lives only for the duration of a single HTTP hit, relying entirely on `@quozen/core` batching to stay performant.
