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
});
