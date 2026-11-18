# 20261117 - Shared @qozara/ai-client Orchestration and Transparent Composite AI UX

## Status
Accepted (supersedes legacy `QuozenAI` / `AgentOrchestrator` in `@quozen/core` and manual `"Refine with AI"` UI triggers from ADRs 20260316 and 20261029)

## Context
After adopting `StandardCommandParser` + `CommandDraftService` (ADR 20261029), several sources of architectural debt and UX friction remained:
1. **Legacy Dead Code in `@quozen/core`**: `packages/core/src/agent/` (`QuozenAI`, `AgentOrchestrator`, `tools.ts`, and a custom wrapper `AiProviderFactory`) kept `@quozen/core` coupled to `@qozara/ai-client` even after `@quozen/ai-services` was introduced.
2. **Duplicated Primitives**: `@quozen/ai-services` duplicated `LruMemoryCache`, `classifyAiError`, and tool-call JSON extraction code also maintained in Quomida.
3. **Opaque "AI vs. Deterministic" UX Friction**: Exposing provider badges in `AgentCommandDrawer` and manual `"Refine with AI"` buttons inside draft dialogs pushed internal implementation choices onto users, while "Disable AI" phrasing implied natural language parsing stopped working when GenAI was off.

## Decision
1. **Pure Domain Core**: Remove `packages/core/src/agent/` and `@qozara/ai-client` from `@quozen/core`. Add `genAiEnabled` alongside `aiEnabled` on `CommandDraftService.createDraft`.
2. **Consolidate on `@qozara/ai-client@1.1.0`**: Upgrade `@quozen/ai-services` to `@qozara/ai-client@^1.1.0`, removing duplicate `LruMemoryCache` and `errors.ts` implementations and refactoring `LlmIntentEscalator` onto `createGenAiToolResolver`. Use `validateAndPrepareAiSettings` in `profile.tsx`.
3. **Transparent Composite AI UX**:
   - Remove technical provider mode badges from `AgentCommandDrawer` and remove manual `"Refine with AI"` buttons from `AddExpenseDrawer`, `ExpenseForm`, and `SettlementModal`.
   - `CommandDraftService` automatically escalates ambiguous/low-confidence inputs when GenAI is enabled and degrades gracefully to editable drafts when GenAI is disabled or offline.
   - Expose `cloud` (Qozara Intelligence) alongside `auto`, `byok`, `local-browser`, `local`, and `disabled` in Profile settings using explicit **Generative AI (GenAI)** terminology.

## Consequences
### Positive
- `@quozen/core` is 100% free of external GenAI SDK dependencies.
- End users experience consistent, fast command entry without manual AI buttons or confusing provider badges.
- Shared cache, error classification, settings preparation, and opt-in `enableLocalAi` enforcement live upstream in `@qozara/ai-client`.

### Negative
- Legacy `QuozenAI` and `AgentOrchestrator` exports are removed; callers must use `CommandDraftService` + `LlmIntentEscalator`.
