import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('Functional Flow', () => {
    // Inject auth token if in Mock mode and setup request interception
    test.beforeEach(async ({ page }) => {
        await setupAuth(page);
    });

    test('should allow creating a group and adding an expense', async ({ page }) => {
        // 1. Go to groups page directly
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 3. Create a Group
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();

        // Modal appears
        await expect(page.getByTestId('drawer-title-group')).toBeVisible();

        await page.getByTestId('input-group-name').fill('Holiday Trip');
        await page.getByTestId('button-submit-group').click();

        // Wait for modal to close
        await expect(page.getByTestId('drawer-title-group')).not.toBeVisible();

        // **NEW: Handle Share Dialog**
        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible(); // Ensure overlay is gone

        // 4. Verify Group Switch
        await expect(page.getByTestId('header').getByText('Holiday Trip')).toBeVisible();

        // 5. Add Expense
        await page.getByTestId('button-nav-add').click();

        // Wait for Add Expense Drawer (converted from page to drawer in UX refactor)
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();

        await page.getByTestId('input-expense-description').fill('Dinner');
        await page.getByTestId('input-expense-amount').fill('50');
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();
        await page.getByTestId('button-submit-expense').click();

        // Wait for drawer to close after submission
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();

        // 6. Verify in List (Dashboard)
        // Since we are currently on the groups page and the drawer just closed, navigate to the Dashboard to see the expense.
        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/.*dashboard/);

        await expect(page.getByText('Dinner')).toBeVisible();
        await expect(page.getByText('$50.00').first()).toBeVisible();
    });

    test('should edit an existing group name and members', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // Create initial group
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Original Name');
        await page.getByTestId('button-submit-group').click();

        // Handle Share Dialog
        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible(); // Ensure overlay is gone

        // Click Meatball Menu and then Edit
        const groupCard = page.getByTestId('group-card').filter({ hasText: 'Original Name' });
        await groupCard.getByTestId('group-menu-trigger').click();
        await page.getByTestId('menuitem-edit').click();

        await expect(page.getByTestId('drawer-title-group')).toBeVisible();
        await page.getByTestId('input-group-name').fill('Renamed Group');

        // Handle new chip-based member input
        await page.getByTestId('input-group-members').fill('newuser@example.com');
        await page.keyboard.press('Enter');

        await page.getByTestId('button-submit-group').click();

        await expect(page.getByTestId('drawer-title-group')).not.toBeVisible();
    });

    test('should allow deleting a group', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 1. Create a group to delete
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Group To Delete');
        await page.getByTestId('button-submit-group').click();

        // Handle Share Dialog
        const shareTitle2 = page.getByTestId('drawer-title-share');
        await expect(shareTitle2).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(shareTitle2).not.toBeVisible(); // Ensure overlay is gone

        // Verify it exists
        const groupCardToDelete = page.getByTestId('group-card').filter({ hasText: 'Group To Delete' });
        await expect(groupCardToDelete).toBeVisible();

        // 2. Click Meatball Menu and then Delete
        await groupCardToDelete.getByTestId('group-menu-trigger').click();
        await page.getByTestId('menuitem-delete').click();

        // 3. Confirm Dialog
        await page.getByTestId('alert-action-confirm').click();

        // 4. Verify it's gone
        await expect(groupCardToDelete).not.toBeVisible();
    });

    test('should allow renaming an account to a Shared Account and switching active accounts on Dashboard', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 1. Create a group with an extra account (Charlie)
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await expect(page.getByTestId('drawer-title-group')).toBeVisible();
        await page.getByTestId('input-group-name').fill('Couples Trip');
        await page.getByTestId('input-group-members').fill('Charlie');
        await page.keyboard.press('Enter');
        await page.getByTestId('button-submit-group').click();

        // Dismiss Share Dialog
        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible();

        // 2. Navigate to Dashboard
        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/.*dashboard/);

        // 3. Rename current account to "Garcia Family" via the Account Switcher pill
        const switcher = page.getByTestId('button-account-switcher');
        await expect(switcher).toBeVisible();
        await switcher.click();
        await page.getByTestId('menu-item-rename-account').click();

        await expect(page.getByTestId('dialog-rename-account')).toBeVisible();
        await page.getByTestId('input-rename-account').fill('Garcia Family');
        await page.getByTestId('button-save-rename-account').click();
        await expect(page.getByTestId('dialog-rename-account')).not.toBeVisible();

        await expect(switcher).toContainText('Garcia Family');

        // 4. Add a $100 expense paid by Garcia Family and split with Charlie
        await page.getByTestId('button-nav-add').click();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        await page.getByTestId('input-expense-description').fill('Hotel');
        await page.getByTestId('input-expense-amount').fill('100');
        await page.getByTestId('select-category').click();
        await page.getByRole('option').nth(0).click();
        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();

        // Verify Garcia Family is owed $50.00
        await expect(page.getByTestId('text-user-balance')).toContainText('$50.00');
        await expect(page.getByText('You are owed')).toBeVisible();

        // 5. Switch active account to Charlie via the Account Switcher pill
        await switcher.click();
        await page.getByRole('menuitem').filter({ hasText: 'Charlie' }).click();

        // Verify active account switched to Charlie and balance perspective flipped to "You owe $50.00"
        await expect(switcher).toContainText('Charlie');
        await expect(page.getByTestId('text-user-balance')).toContainText('$50.00');
        await expect(page.getByText('You owe')).toBeVisible();
    });
});

