import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('Schema Remediation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));
        await setupAuth(page);
    });

    test('should show schema corruption modal and repair it', async ({ page }) => {
        page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.log(`[Browser PageError] ${err.message}`));
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

        // Mock Google APIs to simulate successful repair instead of the offline abort defined globally
        await page.route('https://*.googleapis.com/**', async (route) => {
            console.log(`[Playwright] Intercepted Google API: ${route.request().method()} ${route.request().url()}`);
            if (route.request().method() === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' } });
                return;
            }
            const url = route.request().url();
            let body: any = {};
            if (url.includes('/copy')) {
                body = { id: 'mock-backup-copy-id' };
            } else if (url.includes('/batchUpdate')) {
                body = { replies: [{ addSheet: { properties: { sheetId: 100 } } }] };
            } else if (url.includes('fields=appProperties')) {
                body = { appProperties: { quozen_validation_status: 'READY' } };
            } else if (url.includes('/spreadsheets/')) {
                body = {
                    properties: { title: 'Corrupted Trip' },
                    sheets: [
                        { properties: { sheetId: 0, title: 'Expenses' } },
                        { properties: { sheetId: 1, title: 'Settlements' } },
                        { properties: { sheetId: 2, title: 'Members' } },
                        { properties: { sheetId: 3, title: 'Categories' } },
                        { properties: { sheetId: 4, title: '_migrations' } }
                    ]
                };
            }
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                contentType: 'application/json',
                body: JSON.stringify(body)
            });
        });

        // Click repair
        await page.getByRole('button', { name: 'Attempt Repair' }).click();

        // Should disappear
        await expect(page.getByText('Group File Corrupted')).not.toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Group schema updated successfully').first()).toBeVisible();

        await page.unroute('https://*.googleapis.com/**');
    });

    test('should show app update required modal when schema is incompatible with older client', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // Dispatch INCOMPATIBLE schema error event
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('schema-error', { detail: 'INCOMPATIBLE' }));
        });

        // The modal should appear with "App Update Required" and action buttons
        await expect(page.getByText('App Update Required')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Refresh App' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reset App (Clear Local Data)' })).toBeVisible();

        // Dismiss modal
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await expect(page.getByText('App Update Required')).not.toBeVisible();
    });
});
