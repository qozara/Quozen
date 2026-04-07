# Architecture Decision Record: Multi-User Collaboration via Google Drive

## Context
Quozen is entirely serverless. Enabling multiple users to collaborate on expense groups requires an access control and authorization mechanism without relying on a centralized database.

## Decision
1. **Drive Native Permissions:** Adding members using valid email addresses leverages the Google Drive API to share the underlying spreadsheet directly with their Google Accounts. Google handles the authentication and role assignment.
2. **Alias Members:** Users can add "username-only" members to a group (e.g., `bob123`). These aliases are added to the Sheet for tracking expenses but without any actual Drive authorization granted. This supports tracking debts for friends who refuse to use the app.
3. **Client-Side Discovery:** Users discover groups shared with them by filtering the `files.list` query for `sharedWithMe = true`.

## Consequences
- No backend user management or authentication service is needed; everything relies exclusively on Google OAuth implicit flows.
- Real-time conflict handling (Optimistic Concurrency Control) is implemented by comparing `lastModified` times on rows during edits.
