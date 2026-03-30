---
trigger: always_on
---

1. Branch Management
Initial State Check: Before performing any task, check the current local branch.

If on a feature branch, verify if it matches the current issue.

If on main, do not commit directly to it.

New Issue Workflow: Always branch from main for new tasks.

Naming Convention: Create a new branch using the format: feature/issueShortNameDescription.

Example: For a bug fix on the login screen, use feature/loginFix.

2. Issue Processing
Exploration First: When a GitHub issue link or description is provided, your first step must be to explore the codebase. Identify all relevant files, classes, and methods associated with the issue.

Test-Driven Development: Before modifying any production code, you must create a reproducible test case (unit or integration test) that demonstrates the issue or validates the new requirement.

Validation: Run the test to confirm it fails (for bugs) or provides a baseline (for features) before proceeding with implementation.

3. Execution Order
Verify/Switch to main.

Pull latest changes from origin/main.

Create the feature/ branch.

Analyze files and map dependencies.

Write and run the test case.

Implement code changes only after the test case is established. Make sure you detect the current test framework in use (Vite or Jest), and continue using that framework instead of adding anything else.
