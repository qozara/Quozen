import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('Feature: Ledger Math & Complete CRUD Lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        if (process.env.DEBUG_MOCK === 'true') {
            page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
        }
        await setupAuth(page); // Bypasses auth, sets mock-token-123
    });

    test('should strictly maintain mathematical consistency across complex expense and settlement flows', async ({ page }) => {
        console.log("Starting Test 1...");
        // 1. Initialization
        await page.goto('/groups');
        await ensureLoggedIn(page);
        console.log("Logged in.");

        // 2. Create Group with Offline Members
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Math Validation Trip');
        await page.getByTestId('input-group-members').fill('bob, charlie');
        await page.keyboard.press('Enter');
        console.log("Filled group form.");
        await page.getByTestId('button-submit-group').click();

        // Wait for success toast
        await expect(page.getByTestId('toast-default').first()).toBeVisible({ timeout: 15000 });
        console.log("Group created.");

        // Dismiss ShareDialog
        await page.keyboard.press('Escape');

        // Wait for header to update
        await expect(page.getByTestId('header')).not.toContainText(/Select Group/i, { timeout: 15000 });
        await expect(page.getByTestId('header')).toContainText('Math Validation Trip');
        console.log("Switched to group.");

        // 3. Add Complex Expense (User pays $90, split evenly among 3)
        await page.getByTestId('button-nav-add').click();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        console.log("Expense drawer open.");

        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('90');
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();

        // Verify UI calculates splits correctly (30 each)
        await expect(page.getByTestId('input-split-amount-test-user-id')).toHaveValue('30.00');
        console.log("Splits verified.");
        await page.getByTestId('button-submit-expense').click();

        // Verification of heading absence
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();
        console.log("Expense submitted.");

        // 4. Navigate to Dashboard & Verify Core Math
        await page.getByTestId('button-nav-home').click();

        await expect(page.getByTestId('text-user-balance')).toContainText('60.00');
        await expect(page.getByTestId('text-user-balance')).toContainText('+');
        console.log("Dashboard balance verified.");

        // Balances are open by default, no need to click to expand
        const bobBalance = page.getByTestId('text-balance-bob');
        await expect(bobBalance).toContainText('30.00');
        await expect(bobBalance).toContainText('-');

        const charlieBalance = page.getByTestId('text-balance-charlie');
        await expect(charlieBalance).toContainText('30.00');
        await expect(charlieBalance).toContainText('-');
        console.log("Member balances verified.");

        // 5. Execute Settlement (Bob pays User $30)
        await page.getByTestId(`button-settle-with-bob`).click();
        await expect(page.getByTestId('modal-settlement')).toBeVisible();

        await expect(page.getByTestId('input-settlement-amount')).toHaveValue('30.00');
        await page.getByTestId('button-record-payment').click();
        await expect(page.getByTestId('modal-settlement')).not.toBeVisible();
        console.log("Settlement completed.");

        // 6. Verify Post-Settlement State
        await expect(page.getByTestId('text-user-balance')).toContainText('30.00');
        await expect(page.getByTestId('text-user-balance')).toContainText('+');
        await expect(page.getByTestId('text-balance-bob')).toContainText('0.00');
        await expect(page.getByTestId('text-balance-charlie')).toContainText('30.00');
        await expect(page.getByTestId('text-balance-charlie')).toContainText('-');
        console.log("Final state verified.");

        // 7. Verify Activity Hub UI
        await page.getByTestId('button-nav-expenses').click();
        await expect(page.getByText('Dinner')).toBeVisible();
        console.log("Test 1 Finished.");
    });

    test('should fail gracefully and prevent submission when splits do not match total amount', async ({ page }) => {
        console.log("Starting Test 2...");
        await page.goto('/groups');
        await ensureLoggedIn(page);

        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Validation Group');
        await page.getByTestId('button-submit-group').click();
        await expect(page.getByTestId('toast-default').first()).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('header')).not.toContainText(/Select Group/i, { timeout: 15000 });
        await expect(page.getByTestId('header')).toContainText('Validation Group');

        await page.getByTestId('button-nav-add').click();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Bad Math');
        await page.getByTestId('input-expense-amount').fill('100');

        // This click was missing!
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();

        const splitInput = page.getByTestId('input-split-amount-test-user-id');
        await splitInput.fill('10');

        await page.getByTestId('button-submit-expense').click();

        await expect(page.getByTestId('toast-destructive').first()).toBeVisible();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        console.log("Test 2 Finished.");
    });
});
