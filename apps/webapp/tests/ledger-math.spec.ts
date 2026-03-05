import { test, expect } from '@playwright/test';
import { setupAuth, ensureLoggedIn, resetTestState, setupTestEnvironment } from './utils';

async function createGroup(page: any, name: string, members: string[] = []) {
    await page.getByRole('button', { name: /new group/i }).click();
    await page.getByLabel('Group Name').fill(name);

    for (const member of members) {
        await page.getByLabel('Members (Optional)').fill(member);
        await page.keyboard.press('Enter');
    }

    await page.getByRole('button', { name: /create group/i }).click();

    const shareTitle = page.getByRole('heading', { name: new RegExp(`Share "${name}"`, 'i') });
    await expect(shareTitle).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(shareTitle).not.toBeVisible({ timeout: 5_000 });
}

test.describe('T2 & T3: Ledger Math & Settlement Verification', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestState();
        await setupTestEnvironment(page.context());
        await setupAuth(page);
    });

    test('T2: maintains mathematical consistency across complex expense flows', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        await createGroup(page, 'Math Validation Trip', ['bob', 'charlie']);
        await expect(page.getByTestId('header').getByText('Math Validation Trip')).toBeVisible();

        await page.getByTestId('button-nav-add').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('90');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Food & Dining' }).click();

        await expect(page.getByTestId('input-split-amount-test-user-id')).toHaveValue('30.00');

        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).not.toBeVisible({ timeout: 5_000 });

        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/dashboard/);

        await expect(page.getByTestId('text-user-balance')).toContainText('+$60.00');

        await expect(page.getByTestId('text-balance-bob')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('text-balance-bob')).toContainText('-$30.00');
        await expect(page.getByTestId('text-balance-charlie')).toContainText('-$30.00');
    });

    test('T3: settlement records payment and updates balances to post-settlement state', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        await createGroup(page, 'Settlement Test Group', ['bob', 'charlie']);
        await expect(page.getByTestId('header').getByText('Settlement Test Group')).toBeVisible();

        await page.getByTestId('button-nav-add').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('90');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Food & Dining' }).click();
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).not.toBeVisible({ timeout: 5_000 });

        await page.getByTestId('button-nav-home').click();
        await expect(page.getByTestId('text-user-balance')).toContainText('+$60.00');

        await expect(page.getByTestId('text-balance-bob')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('text-balance-bob')).toContainText('-$30.00');

        await page.getByTestId('button-settle-with-bob').click();
        await expect(page.getByTestId('modal-settlement')).toBeVisible();
        await expect(page.getByTestId('input-settlement-amount')).toHaveValue('30.00');

        await page.getByTestId('button-record-payment').click();
        await expect(page.getByTestId('modal-settlement')).not.toBeVisible({ timeout: 5_000 });

        await expect(page.getByTestId('text-user-balance')).toContainText('+$30.00');
        await expect(page.getByTestId('text-balance-bob')).toContainText('$0.00');
        await expect(page.getByTestId('text-balance-charlie')).toContainText('-$30.00');

        await page.getByTestId('button-nav-expenses').click();
        await page.getByRole('tab', { name: /transfers/i }).click();
        await expect(page.getByText('$30.00')).toBeVisible();
    });

    test('T2b: rejects submission and shows toast when splits do not match total', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        await createGroup(page, 'Validation Group');

        await page.getByTestId('button-nav-add').click();
        await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Bad Math');
        await page.getByTestId('input-expense-amount').fill('100');
        await page.getByTestId('select-category').click();
        await page.getByRole('option', { name: 'Other' }).click();

        await page.getByTestId('input-split-amount-test-user-id').fill('10');
        await page.getByTestId('button-submit-expense').click();

        await expect(
            page.getByRole('status').getByText(/split amounts don't match/i)
        ).toBeVisible({ timeout: 5_000 });
        await expect(page.getByRole('heading', { name: /add expense/i })).toBeVisible();
    });
});
