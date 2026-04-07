# Architecture Decision Record: Extraction to Monorepo Core SDK

## Context
Quozen was tightly coupled as a pure client-side SPA. To distribute business logic to AI agents, CLI tools, and external API integrations, the Google Drive wrapper, storage adapters, and financial algorithms needed to be decoupled from the DOM.

## Decision
1. **Monorepo Migration:** The repository was converted to an npm workspace monorepo separating `packages/core` from `apps/webapp`.
2. **Isomorphic Core:** `@quozen/core` is built as a pure TypeScript/JavaScript library unattached to React or the browser. It exposes the API wrappers and heavy math (split-bill parsing) as a reusable SDK.
3. **Dependency Injection:** The core expects generic instances of `StorageAdapter` (e.g., `GoogleDriveAdapter`, `InMemoryAdapter`) and Auth providers, rather than relying on global `window` setups.

## Consequences
- Enables execution of Quozen's core in Node.js, Cloudflare Workers, and Edge environments.
- Allows fully isolated, blazing-fast tests using `InMemoryAdapter` without spinning up DOM testing libraries.
