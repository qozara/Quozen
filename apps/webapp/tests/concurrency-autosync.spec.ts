/**
 * T4: E2E Concurrency & Auto-Sync
 *
 * Verifies that:
 *   - When the MockServer's internal state is mutated to simulate a background
 *     write by another user, the Auto-Sync mechanism (or Pull-to-Refresh) detects
 *     the change and updates the DOM without a full page reload.
 *   - When the mock server responds with a 409 Conflict, the UI surfaces an
 *     appropriate error message.
 */
import { test, expect } from '@playwright/test';
import { setupAuth, ensureLoggedIn, resetTestState, setupTestEnvironment } from './utils';
import { mockServer } from './mock-server';

test.describe('T4: Concurrency & Auto-Sync', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestState();
        await setupTestEnvironment(page.context());
        await setupAuth(page);
    });

    test('T4a: Auto-Sync detects background write and updates the UI without reload', async ({ page }) => {
        // ── 1. Boot & create group with one offline member ───────────────────
        await page.goto('/');
        await ensureLoggedIn(page);

        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel(/group name/i).fill('Sync Test Group');
        await page.getByRole('button', { name: /create group/i }).click();
        await page.keyboard.press('Escape').catch(() => { });
        await expect(page.getByTestId('header').getByText('Sync Test Group')).toBeVisible({ timeout: 10_000 });

        // ── 2. Capture the current spreadsheet id via URL or data attribute ──
        // We navigate to dashboard to get a stable landing page
        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/dashboard/);

        // Note the initial balance (should be "balanced" / $0.00)
        await expect(page.getByTestId('text-user-balance')).toContainText('0.00');

        // ── 3. Background write: inject an expense directly into MockServer ──
        // Retrieve the active group id from localStorage
        const activeGroupId = await page.evaluate(() => {
            const raw = localStorage.getItem('quozen-settings');
            if (!raw) return null;
            try { return JSON.parse(raw)?.activeGroupId ?? null; } catch { return null; }
        });

        if (activeGroupId) {
            await mockServer.injectExpense(activeGroupId, {
                id: `bg-expense-${Date.now()}`,
                date: new Date().toISOString(),
                description: 'Background Dinner',
                amount: 60,
                paidBy: 'test-user-id',
                category: 'Food & Dining',
                splits: [{ userId: 'test-user-id', amount: 60 }],
            });
        }

        // ── 4. Trigger Pull-to-Refresh (manual sync) ─────────────────────────
        const refreshBtn = page.getByTestId('button-refresh');
        if (await refreshBtn.isVisible()) {
            await refreshBtn.click();
        } else {
            // Auto-sync is enabled; wait for the polling interval to fire
            // (test env uses a very short interval defined via VITE_POLLING_INTERVAL)
            await page.waitForTimeout(5_000);
        }

        // ── 5. Verify DOM updated with new expense data ─────────────────────
        await expect(page.getByTestId('text-user-balance')).not.toContainText('0.00', { timeout: 10_000 });
    });

    test('T4b: UI surfaces conflict error (409) when concurrent edit is detected', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        // Create a group and add one expense so edit-expense route is available
        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel(/group name/i).fill('Conflict Group');
        await page.getByRole('button', { name: /create group/i }).click();
        await page.keyboard.press('Escape').catch(() => { });

        await page.getByTestId('button-nav-add').click();
        await page.getByTestId('input-expense-description').fill('Initial Dinner');
        await page.getByTestId('input-expense-amount').fill('30');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Other' }).click();
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).not.toBeVisible({ timeout: 5_000 });

        // Navigate to the expense list and click edit on the expense
        await page.getByTestId('button-nav-expenses').click();
        await page.getByText('Initial Dinner').click();

        // Before saving, inject a 409 for the next write request
        mockServer.forceNextError(409);

        // Attempt to save — should trigger conflict dialog
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByText(/conflict|modified|another user/i)).toBeVisible({ timeout: 5_000 });
    });
});
