# Edge REST API Architecture

## Request Flow

This diagram illustrates how a third-party application or AI Agent communicates with Quozen's edge network, resolves Google OAuth authentication statically at the edge, and triggers the core logic.

```mermaid
sequenceDiagram
    participant Client as External Client / Agent
    participant Edge as Edge API (Hono Router)
    participant Auth as Auth Middleware
    participant GoogleAuth as Google Identity API
    participant SDK as QuozenClient (@quozen/core)
    participant Drive as Google Drive API

    Client->>Edge: POST /api/v1/groups/G123/expenses (Bearer Token)
    Edge->>Auth: Intercept Request
    
    Auth->>GoogleAuth: GET /oauth2/v3/userinfo (Validate Token)
    GoogleAuth-->>Auth: User Profile (id, email, name)
    
    Auth->>SDK: new QuozenClient({ auth, user })
    Auth->>Edge: Inject SDK into Context (c.set('quozen', sdk))
    
    Edge->>Edge: Zod Schema Validation (Body & Params)
    Edge->>SDK: quozen.ledger('G123').addExpense(dto)
    
    SDK->>Drive: readGroupData (if cache miss)
    Drive-->>SDK: Raw Data
    SDK->>Drive: appendRow(Expenses, rowData)
    Drive-->>SDK: 200 OK
    
    SDK-->>Edge: Expense Domain Object
    Edge-->>Client: 201 Created (JSON Response)
```
