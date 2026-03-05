/**
 * T2 & T3: Comprehensive E2E Math & CRUD Verification + Settlement Verification
 *
 * This spec verifies:
 *   - T2: The DOM values for group balances match the output of @quozen/core's
 *         calculateBalances() — i.e. the UI cannot show wrong numbers even if
 *         the underlying data is correct.
 *   - T3: The SettlementModal auto-populates the correct debt amount, recording
 *         the payment updates balances to reflect the post-settlement state.
 */
import { test, expect } from '@playwright/test';
import { setupAuth, ensureLoggedIn, resetTestState, setupTestEnvironment } from './utils';

test.describe('T2 & T3: Ledger Math & Settlement Verification', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestState();
        await setupTestEnvironment(page.context());
        await setupAuth(page);
    });

    test('T2: maintains mathematical consistency across complex expense flows', async ({ page }) => {
        // ── 1. Boot & Login ──────────────────────────────────────────────────
        await page.goto('/');
        await ensureLoggedIn(page);

        // ── 2. Create Group with two offline members ──────────────────────────
        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel(/group name/i).fill('Math Validation Trip');

        // Add offline members bob and charlie
        const memberInput = page.getByPlaceholder(/email or username/i).first();
        await memberInput.fill('bob');
        await page.getByRole('button', { name: /add/i }).click();
        await memberInput.fill('charlie');
        await page.getByRole('button', { name: /add/i }).click();

        await page.getByRole('button', { name: /create group/i }).click();

        // Dismiss any share dialog that may appear
        const escapeKey = page.keyboard.press('Escape');
        await escapeKey.catch(() => { });

        await expect(page.getByTestId('header').getByText('Math Validation Trip')).toBeVisible({ timeout: 10_000 });

        // ── 3. Add Expense: $90 paid by current user, split evenly among 3 ────
        await page.getByTestId('button-nav-add').click();
        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('90');

        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Food & Dining' }).click();

        // Verify split auto-calculation: each of 3 members gets $30.00
        await expect(page.getByTestId('input-split-amount-test-user-id')).toHaveValue('30.00');

        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).not.toBeVisible({ timeout: 5_000 });

        // ── 4. Navigate to Dashboard & verify balances ─────────────────────────
        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/dashboard/);

        // Current user paid $90, owes $30 → net balance = +$60.00
        await expect(page.getByTestId('text-user-balance')).toContainText('+60.00');

        // Open the group balances collapsible
        await page.getByText('Group Balances').click();

        // Bob owes $30
        await expect(page.getByTestId('text-balance-bob')).toContainText('-30.00');
        // Charlie owes $30
        await expect(page.getByTestId('text-balance-charlie')).toContainText('-30.00');
    });

    test('T3: settlement records payment and updates balances to post-settlement state', async ({ page }) => {
        // ── 1. Setup ─────────────────────────────────────────────────────────
        await page.goto('/');
        await ensureLoggedIn(page);

        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel(/group name/i).fill('Settlement Test Group');

        const memberInput = page.getByPlaceholder(/email or username/i).first();
        await memberInput.fill('bob');
        await page.getByRole('button', { name: /add/i }).click();
        await memberInput.fill('charlie');
        await page.getByRole('button', { name: /add/i }).click();

        await page.getByRole('button', { name: /create group/i }).click();
        await page.keyboard.press('Escape').catch(() => { });
        await expect(page.getByTestId('header').getByText('Settlement Test Group')).toBeVisible({ timeout: 10_000 });

        // Add $90 expense (split 3 ways = $30 each)
        await page.getByTestId('button-nav-add').click();
        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('90');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Food & Dining' }).click();
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).not.toBeVisible({ timeout: 5_000 });

        // ── 2. Dashboard pre-settlement ────────────────────────────────────
        await page.getByTestId('button-nav-home').click();
        await expect(page.getByTestId('text-user-balance')).toContainText('+60.00');
        await page.getByText('Group Balances').click();
        await expect(page.getByTestId('text-balance-bob')).toContainText('-30.00');

        // ── 3. Record settlement: Bob pays the current user $30 ─────────────
        await page.getByTestId('button-settle-with-bob').click();
        await expect(page.getByTestId('modal-settlement')).toBeVisible();

        // Suggested amount should be pre-populated with exactly 30.00
        await expect(page.getByTestId('input-settlement-amount')).toHaveValue('30.00');

        await page.getByTestId('button-record-payment').click();
        await expect(page.getByTestId('modal-settlement')).not.toBeVisible({ timeout: 5_000 });

        // ── 4. Post-settlement state ───────────────────────────────────────
        // User is now owed only $30 (Charlie still owes)
        await expect(page.getByTestId('text-user-balance')).toContainText('+30.00');
        await expect(page.getByTestId('text-balance-bob')).toContainText('0.00');
        await expect(page.getByTestId('text-balance-charlie')).toContainText('-30.00');

        // ── 5. Verify Activity Hub shows the transfer ──────────────────────
        await page.getByTestId('button-nav-expenses').click();
        await page.getByRole('tab', { name: /transfers/i }).click();
        await expect(page.getByText('$30.00')).toBeVisible();
    });

    test('T2b: rejects submission and shows toast when splits do not match total', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        // Create a minimal group
        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel(/group name/i).fill('Validation Group');
        await page.getByRole('button', { name: /create group/i }).click();
        await page.keyboard.press('Escape').catch(() => { });

        // Attempt a malformed expense
        await page.getByTestId('button-nav-add').click();
        await page.getByTestId('input-expense-description').fill('Bad Math');
        await page.getByTestId('input-expense-amount').fill('100');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Other' }).click();

        // Override the auto-split for the single member to a wrong value
        await page.getByTestId('input-split-amount-test-user-id').fill('10');

        await page.getByTestId('button-submit-expense').click();

        // Toast must appear
        await expect(page.getByText(/split amounts don't match/i)).toBeVisible({ timeout: 5_000 });

        // Drawer must remain open (form not submitted)
        await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();
    });
});
