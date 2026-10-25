# Rule: Mandatory Pre-Deployment Validation on Changes

## Context
For the Quozen project, after making any code changes, the agent must always validate all the tasks that the predeploy pipeline requires before completing the task.

## Mandatory Validation Tasks
1. **TypeScript Check (`npm run check`)**:
   - Run typechecking across all workspaces (`tsc --noEmit`).
   - Must pass with 0 errors.

2. **Tests (`npm run test`)**:
   - Run unit and integration tests across workspaces (`npm test --workspace=@quozen/core` and `npm test --workspace=@quozen/webapp`).
   - All tests must pass with 0 failures.

3. **Build (`npm run build`)**:
   - Run build across all workspaces (`npm run build`).
   - Confirms bundling (Vite, tsup, RxDB schemas, and DTS output) succeeds with 0 errors.

4. **Vulnerabilities**:
   - Ensure package overrides and dependencies remain clean without introducing unpatched CVEs.
