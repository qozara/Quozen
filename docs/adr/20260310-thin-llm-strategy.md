# Architecture Decision Record: Thin LLM Strategy

## Context
During initial Agent iterations, the LLM was tasked with mathematical operations, specifically splitting expenses manually among group members. LLMs are notoriously poor calculators and often hallucinated penny distributions extending to multiple decimal points (e.g., $100 / 3 = 33.33, 33.33, 33.33), causing database mismatches.

## Decision
1. **Delegation of Responsibility:** The LLM's computational responsibilities are stripped entirely. The AI acts strictly as an Intent Extraction engine (identifying payer, amount, and description).
2. **Core Reclaimer:** All math, including exact-penny split distributions, dates, and localized formatting, is handled firmly by the `@quozen/core` package functions (`LedgerService` and `distributeAmount`). 
3. **Schema Relaxation:** AI Tool schemas are simplified to make parameters like `splits` optional, letting the native code infer equal splits seamlessly when applicable.

## Consequences
- Guaranteed mathematical consistency.
- Standardized error handling preventing raw JS exceptions from bubbling up through the AI responses.
