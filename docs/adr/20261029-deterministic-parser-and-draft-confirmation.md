# 20261029 - Deterministic Command Parser, Locale Packs, and Human-in-the-Loop Draft Confirmation

## Context
Previously, Quozen's natural language command feature (accessed via voice input and quick command box) relied directly on an LLM to parse natural language instructions and immediately executed operations directly on the ledger (adding expenses or recording settlements without explicit user review).

This approach introduced several major limitations:
1. **Offline & AI-Disabled Inoperability**: Users without an internet connection or without an AI provider configured (or users preferring complete privacy) could not use the command bar or voice dictation feature, even for standard, common patterns ("dinner 40 with Bob", "pagué 1500 almuerzo", "settle up with Alice").
2. **Lack of Human-in-the-Loop Confirmation**: By writing directly to the ledger without showing a pre-filled draft, errors in LLM inference, misheard voice speech, or ambiguous name matches could silently write incorrect transactions to RxDB and Google Drive.
3. **Coupled Dependencies**: `@quozen/core` directly depended on external AI client libraries (`@qozara/ai-client`), violating domain decoupling and preventing pure, lightweight offline operation.
4. **Latency & Cost**: Simple everyday commands took hundreds or thousands of milliseconds waiting on LLM cloud responses, consuming unnecessary API tokens.

In contrast, our sister application Quomida adopted a hybrid deterministic parser with locale packs, offline-first intent resolution, human-in-the-loop recipe review, and optional LLM escalation (ADRs 0024, 0025, 0026).

## Decision

We adopt **Option B: Deterministic-First Command Parser with Locale Packs, Human-in-the-Loop Review/Confirmation Dialogs, and Optional Hexagonal LLM Escalation**:

### 1. Pure Deterministic Parser in Core (`@quozen/core`)
- Implemented `StandardCommandParser` in `@quozen/core/src/parser/` executing in `< 1ms` with 0 external dependencies and 0 network calls.
- Purely deterministic tokenization and extraction supporting:
  - English (`en`) and Spanish (`es`) locale packs (`ParserLocalePack`).
  - Common currencies (`$`, `€`, `£`, `USD`, `lucas` multiplier).
  - Split strategies: equal split across entire group, specific participants (`with Bob, Charlie`), exclusions (`sin Ana`, `except Bob`), and exact item amounts (`Bob 30 y Charlie 20`).
  - Relative dates (`yesterday`, `ayer`) and categories (`dinner`, `uber`, `supermarket`).
  - Settlement recognition (`I paid Bob 25 cash`, `settle up with Alice`, `Diego me pagó 50 por transferencia`).
  - Word boundary and Unicode-aware matching (`\p{L}` regexes with `u` flag) for accented characters.

### 2. Domain Service & Gazetteer Member Resolution
- Implemented `CommandDraftService` in `@quozen/core/src/services/`:
  - Matches members using prioritized resolution: exact name -> case-insensitive -> prefix matching -> Levenshtein distance <= 1 for length >= 4.
  - Distributes equal splits accurately using `distributeAmount`.
  - Computes settle-up amounts automatically from the ledger when the user says "settle up with X".
  - Collects ambiguities (`ambiguous_member`, `unmatched_member`, `split_sum_mismatch`) to warn the user or guide escalation.

### 3. Hexagonal Decoupling (`@quozen/ai-services`)
- Extracted AI client dependencies out of `@quozen/core` into a new `@quozen/ai-services` package.
- `CommandDraftService` receives an optional `IIntentEscalator` adapter.
- `LlmIntentEscalator` implements `IIntentEscalator` via `@qozara/ai-client`, caching responses using a 50-item `LruMemoryCache`, classifying errors into typed categories (`classifiedError`), and stripping sensitive financial ledger balances from the prompt payload.

### 4. Human-in-the-Loop UI Confirmation Dialogs
- **Never Auto-Commit**: Neither the deterministic parser nor the LLM writes directly to `LedgerService` or the storage layer.
- **Two Specialized Draft Dialogs**:
  1. **Expense Draft**: Opens `AddExpenseDrawer` / `ExpenseForm` in draft mode, prefilling description, amount, payer, category, and individual member split rows. If ambiguities are present, an alert banner displays the warnings. An inline **"Refine with AI"** button allows one-click LLM escalation if AI is configured and online.
  2. **Settlement Draft**: Opens `SettlementModal` in draft mode, prefilling `fromUserId`, `toUserId`, `amount`, and `method`, with an alert banner and **"Refine with AI"** button. The modal creates a new settlement (`addSettlement`) only when the user reviews and confirms.
- **CLI Confirmation**: The CLI interactive command mode prints a draft review table and prompts `confirm` before saving.
- **Always Available**: The header agent command trigger is available unconditionally, working completely offline with an "Offline Smart Parser" badge when AI is disabled.

## Consequences
- **Instant Response**: 90%+ of standard commands resolve in < 1ms offline with 0 token costs.
- **Offline & Private**: Users can use voice dictation and quick text commands completely offline without an AI provider configured.
- **Safety**: Users always see and approve parsed transactions before anything is written to the ledger.
- **Clean Architecture**: Domain core remains pure and deterministic; AI escalation is an optional hexagonal plugin.
