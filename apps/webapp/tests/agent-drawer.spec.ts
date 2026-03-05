import { test, expect } from '@playwright/test';
import { setupAuth, ensureLoggedIn, resetTestState, setupTestEnvironment } from './utils';

test.describe('V3: AI Agent Integration', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestState();
        await setupTestEnvironment(page.context());

        // Intercept proxy availability check
        await page.route('http://localhost:8788/', async route => {
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: 'Quozen AI Proxy is Running'
            });
        });

        // Intercept chat request
        await page.route('**/api/v1/agent/chat', async route => {
            if (route.request().method() === 'OPTIONS') {
                await route.fulfill({
                    status: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    }
                });
                return;
            }

            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                contentType: 'application/json',
                body: JSON.stringify({
                    type: 'tool_call',
                    tool: 'addExpense',
                    arguments: {
                        description: 'AI Generated Dinner',
                        amount: 45,
                        category: 'Food & Dining',
                        paidByUserId: 'test-user-id',
                        splits: [{ userId: 'test-user-id', amount: 45 }]
                    }
                })
            });
        });

        await setupAuth(page);
    });

    test('AgentCommandDrawer parses tool_call and updates UI', async ({ page }) => {
        await page.goto('/');
        await ensureLoggedIn(page);

        await page.getByRole('button', { name: /new group/i }).click();
        await page.getByLabel('Group Name').fill('AI Group');
        await page.getByRole('button', { name: /create group/i }).click();

        const shareTitle = page.getByRole('heading', { name: /Share "AI Group"/i });
        await expect(shareTitle).toBeVisible({ timeout: 10_000 });
        await page.keyboard.press('Escape'); // Close share dialog
        await expect(shareTitle).not.toBeVisible({ timeout: 5_000 });

        await page.getByTestId('button-ai-assistant').click();
        await expect(page.getByRole('heading', { name: /AI Assistant/i })).toBeVisible();

        await page.getByPlaceholder(/Type or dictate/i).fill('Add 45 for dinner');
        await page.getByTestId('button-ai-submit').click();

        await expect(page.getByRole('heading', { name: /AI Assistant/i })).not.toBeVisible({ timeout: 5000 });
        await expect(page.getByText('AI Generated Dinner').first()).toBeVisible({ timeout: 5000 });
    });
});
