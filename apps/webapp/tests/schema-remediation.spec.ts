import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('Schema Remediation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));
        await setupAuth(page);
    });

    test('should show schema corruption modal and repair it', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 1. Create a Group
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Corrupted Trip');
        await page.getByTestId('button-submit-group').click();

        // Handle Share Dialog
        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible();

        // Navigate to dashboard
        await page.getByTestId('button-nav-home').click();
        await expect(page).toHaveURL(/.*dashboard/);

        // Force malformed sheet
        await page.evaluate(async () => {
            await fetch('/_test/force-malformed', { method: 'POST' });
            // In mock mode, ValidationService can't hit real Google APIs, 
            // so we dispatch the UI event directly to test the modal flow.
            window.dispatchEvent(new CustomEvent('schema-error', { detail: 'CORRUPTED' }));
        });

        // The modal should appear
        await expect(page.getByText('Group File Corrupted')).toBeVisible({ timeout: 10000 });

        // Click repair
        await page.getByRole('button', { name: 'Attempt Repair' }).click();

        // Should disappear
        await expect(page.getByText('Group File Corrupted')).not.toBeVisible({ timeout: 10000 });
        await expect(page.getByText('Group schema updated successfully')).toBeVisible();
    });
});
