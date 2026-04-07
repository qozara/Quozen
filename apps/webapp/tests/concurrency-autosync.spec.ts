import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';
import { MockServer } from './mock-server';

async function createGroup(page: any, mockServer: MockServer, name: string, members: string[] = []): Promise<string> {
    await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
    await page.getByTestId('input-group-name').fill(name);

    for (const member of members) {
        await page.getByTestId('input-group-members').fill(member);
        await page.keyboard.press('Enter');
    }

    await page.getByTestId('button-submit-group').click();

    const shareTitle = page.getByTestId('drawer-title-share');
    await expect(shareTitle).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(shareTitle).not.toBeVisible({ timeout: 5_000 });

    // Capture the group ID immediately after creation while adapter has only this group
    const groupId = await mockServer.getLatestGroupId();
    return groupId ?? '';
}

test.describe('T4: Concurrency & Auto-Sync', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuth(page);
    });

    test('T4a: Auto-Sync detects background write and updates the UI without reload', async ({ page, mockServer }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // Capture group ID at creation time — adapter is fresh from resetTestState
        const activeGroupId = await createGroup(page, mockServer, 'Sync Test Group', ['bob']);
        await expect(page.getByTestId('header').getByText('Sync Test Group')).toBeVisible({ timeout: 15000 });

        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/dashboard/);
        await expect(page.getByTestId('text-user-balance')).toContainText('$0.00');

        if (activeGroupId) {
            await mockServer.injectExpense(activeGroupId, {
                id: `bg-expense-${Date.now()}`,
                date: new Date().toISOString(),
                description: 'Background Dinner',
                amount: 60,
                paidByUserId: 'test-user-id',
                category: 'Food & Dining',
                splits: [{ userId: 'bob', amount: 60 }], // User paid 60, Bob consumed 60
            });
        }

        const refreshBtn = page.getByTestId('button-refresh');
        if (await refreshBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await refreshBtn.click();
        } else {
            // Use deterministic E2E trigger instead of flaky visibility hacks
            await page.evaluate(() => window.__triggerAutoSync?.());
        }

        await expect(page.getByTestId('text-user-balance')).not.toContainText('$0.00', { timeout: 10_000 });
    });

    test('T4b: UI surfaces conflict dialog when expense is modified by another user', async ({ page, mockServer }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        const activeGroupId = await createGroup(page, mockServer, 'Conflict Group');
        await expect(page.getByTestId('header').getByText('Conflict Group')).toBeVisible({ timeout: 15000 });

        await page.getByTestId('button-nav-add').click();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Initial Dinner');
        await page.getByTestId('input-expense-amount').fill('30');
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible({ timeout: 5_000 });

        // Navigate to the expense and open edit form — this loads expense.updatedAt into the form
        await page.getByTestId('button-nav-expenses').click();
        await page.getByText('Initial Dinner').click();
        await expect(page).toHaveURL(/edit-expense/);
        await expect(page.getByTestId('drawer-title-edit-expense')).toBeVisible();

        // Get the expense ID from the URL
        const expenseId = page.url().split('/edit-expense/')[1];

        if (activeGroupId && expenseId) {
            // Overwrite the existing row's lastModified to a future timestamp in-place.
            // This means getExpenses().find(id) returns the row with future updatedAt,
            // which is > the expectedLastModified cached in the form → ConflictError thrown.
            await mockServer.updateExpenseTimestamp(activeGroupId, expenseId);
        }

        await page.getByTestId('button-submit-expense').click();

        await expect(page.getByTestId('alert-conflict-title')).toBeVisible({ timeout: 5_000 });
    });
});
