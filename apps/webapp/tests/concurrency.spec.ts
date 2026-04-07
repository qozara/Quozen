import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('Feature: E2E Concurrency & Auto-Sync', () => {
    test.beforeEach(async ({ page }) => {
        if (process.env.DEBUG_MOCK === 'true') {
            page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
        }

        await setupAuth(page);
    });

    test('should automatically synchronize background changes from other users', async ({ page, mockServer }) => {
        // 1. Setup - Create a group and navigate to dashboard
        await page.goto('/groups');
        await ensureLoggedIn(page);

        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Sync Validation Trip');
        await page.getByTestId('button-submit-group').click();
        await expect(page.getByTestId('toast-default').first()).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');

        // Wait for group to settle
        await expect(page.getByTestId('header')).not.toContainText(/Select Group/i, { timeout: 15000 });
        await expect(page.getByTestId('header')).toContainText('Sync Validation Trip');

        const adapter = mockServer.adapter;
        const files = await adapter.listFiles("");
        const groupId = files.find(f => f.name.includes('Sync Validation Trip'))?.id;

        expect(groupId).toBeDefined();
        console.log(`[Test] Active Group ID identified: ${groupId}`);

        // 2. Initial State Verification
        await page.getByTestId('button-nav-home').click();
        await expect(page.getByTestId('text-user-balance')).toContainText('0.00');

        // 3. BACKGROUND MUTATION (Simulate Bob adding an expense)
        // Accessing the adapter directly from the test process! 
        // This is shared because setupTestEnvironment uses mockServer which uses this adapter.

        // Bob pays $30 for Dinner (split with Test User)
        await mockServer.injectExpense(groupId!, {
            id: "exp-2",
            date: new Date().toISOString(),
            description: "Dinner",
            amount: 30,
            paidByUserId: "bob",
            category: "Food",
            splits: [
                { userId: "bob", amount: 15 },
                { userId: "test-user-id", amount: 15 }
            ]
        });

        console.log("[Test] Background mutation applied. Waiting for Auto-Sync...");

        // Force immediate deterministic sync via E2E hook
        await page.evaluate(() => window.__triggerAutoSync?.());

        // 4. VERIFY AUTO-UPDATE
        // Test User should now owe $15.00
        await expect(page.getByTestId('text-user-balance')).toContainText('15.00', { timeout: 10000 });
        await expect(page.getByTestId('text-user-balance')).toContainText('-');

        // Check Recent Activity
        await expect(page.getByText('Dinner')).toBeVisible();

        console.log("[Test] Auto-Sync successful!");
    });

    test('should handle resource conflicts (409) gracefully', async ({ page, mockServer }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // Create group
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Conflict Trip');
        await page.getByTestId('button-submit-group').click();
        await expect(page.getByTestId('toast-default').first()).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('header')).not.toContainText(/Select Group/i, { timeout: 15000 });
        await expect(page.getByTestId('header')).toContainText('Conflict Trip');

        // Add an initial expense
        await page.getByTestId('button-nav-add').click();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Conflict Item');
        await page.getByTestId('input-expense-amount').fill('10');
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();

        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();

        await page.evaluate(() => {
            // Hard to find expenseId from here, let's just find the last expense
            return null;
        });

        // Navigate to edit
        await page.getByTestId('button-nav-home').click();
        await expect(page.getByTestId('dashboard-view')).toBeVisible();

        const item = page.getByTestId(/expense-item-/).filter({ hasText: 'Conflict Item' }).first();
        await expect(item).toBeVisible();
        await item.click();

        await expect(page.getByTestId('drawer-title-edit-expense')).toBeVisible();

        // 3. SIMULATE ANOTHER USER CHANGING IT (Modify in background)
        // Just force next error
        mockServer.forceNextError(409);

        // Try to save
        await page.getByTestId('input-expense-description').fill('My Conflict Version');
        await page.getByTestId('button-submit-expense').click();

        // Verify Conflict Modal
        await expect(page.getByTestId('alert-conflict-title')).toBeVisible();
        console.log("[Test] Conflict handled!");
    });
});
