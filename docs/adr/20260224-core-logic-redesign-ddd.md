# Architecture Decision Record: Domain-Driven Design for Core Logic

## Context
The `@quozen/core` package initially leaked implementation details (like Sheet `_rowIndex`) directly to consumers, making it brittle. As the system prepared for REST API integration, state management and data formatting needed robust boundaries.

## Decision
1. **Facade Pattern (`QuozenClient`):** A single SDK entry point instantiates and wires together the repositories, storage adapters, and financial services.
2. **Data Mapper Pattern:** A strict `SheetDataMapper` isolates the Google Sheets array formats from the pure Domain Entities (e.g., `Expense`, `Settlement`). The domain models rely strictly on UUIDs (`id`); tracking specific rows is handled entirely internally by the repositories.
3. **Optimistic Concurrency & Caching:** A read-through proxy requests the Drive file's `modifiedTime` metadata first. If untouched, memory is used. If parallel writes occur, ETag-like metadata validation protects against overwrites.

## Consequences
- The WebApp and CLI interact strictly with rich domain objects (`GroupLedger` and `LedgerAnalytics`) without needing functional array manipulation.
- Modifying how storage works (e.g., expanding columns or switching backends) requires zero changes to the consumer applications.
