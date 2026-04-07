# Architecture Decision Record: Group Sharing & Metadata-First Architecture

## Context
Inviting users required manual entry of their emails or asking them to use the Google Picker. This was friction-heavy. Furthermore, file discovery solely relied on a `Quozen - ...` name prefix, leading to brittle discovery if users renamed their folders.

## Decision
1. **Magic Link Flow:** Implement an open-share URL (`/join/:id`) that functions like Google Docs links. When activated, the owner sets the specific Drive file permissions to `anyone, writer`. 
2. **Metadata-First Discovery:** When a new group is created, it is stamped using Drive file `properties` (e.g., `quozen_type: 'group'`, `version: '1.0'`). The application's core reconciliation engine now searches strictly by this metadata instead of file names, preventing "ghost" files.
3. **Atomic Member Joins:** When a user lands on the Magic Link, the system authenticates them via Google, checks the file metadata for safety, and then uses an atomic `appendRow` API on the Google Sheet to append their name to the `Members` tab. This avoids race conditions compared to reading/writing the entire sheet.
4. **Manual Import Blessing:** Legacy groups without metadata can be "blessed" (tagged with proper metadata) by the user explicitly opening them via a manual Google Picker flow. The client checks the tabs, and if it looks like a Quozen group, it patches the metadata.

## Consequences
- We rely heavily on atomic `appendRow` for joining instead of full array rewrites to prevent multiple users joining concurrently from overriding each other.
- Magic link permissions are "writer" for "anyone". The owner must turn it off manually to restrict access again.
- Files must have `properties` globally visible (`PUBLIC`) so other accounts can identify them as Quozen files.
