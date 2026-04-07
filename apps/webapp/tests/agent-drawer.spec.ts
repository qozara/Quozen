import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

test.describe('V3: AI Agent Integration', () => {
    test.beforeEach(async ({ page }) => {
        // 1. Force Ollama Health Check to pass (Guarantees AI activates regardless of env vars)
        await page.route('**/api/tags', async route => {
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                contentType: 'application/json',
                body: JSON.stringify({ models: [{ name: 'mock-model' }] })
            });
        });

        // 2. Force Ollama Chat Response
        await page.route('**/api/chat', async route => {
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
                    message: {
                        tool_calls: [{
                            function: {
                                name: 'addExpense',
                                arguments: {
                                    description: 'AI Generated Dinner',
                                    amount: 45,
                                    category: 'Food & Dining',
                                    paidByUserId: 'test-user-id',
                                    splits: [{ userId: 'test-user-id', amount: 45 }]
                                }
                            }
                        }]
                    }
                })
            });
        });

        // 3. Fallback: Intercept Proxy Health Check
        const proxyHealthMock = async (route: any) => {
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: 'Quozen AI Proxy is Running'
            });
        };
        await page.route('http://localhost:8788', proxyHealthMock);
        await page.route('http://localhost:8788/', proxyHealthMock);

        // 4. Fallback: Intercept Proxy Chat
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
        await page.goto('/groups');
        await ensureLoggedIn(page);

        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('AI Group');
        await page.getByTestId('button-submit-group').click();

        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible({ timeout: 15000 });
        await page.keyboard.press('Escape'); // Close share dialog
        await expect(shareTitle).not.toBeVisible({ timeout: 5_000 });

        await page.getByTestId('button-ai-assistant').click();
        await expect(page.getByTestId('drawer-title-ai')).toBeVisible({ timeout: 10000 });

        await page.getByPlaceholder(/Type or dictate/i).fill('Add 45 for dinner');
        await page.getByTestId('button-ai-submit').click();

        await expect(page.getByTestId('drawer-title-ai')).not.toBeVisible({ timeout: 5000 });
        await expect(page.getByText('AI Generated Dinner').first()).toBeVisible({ timeout: 5000 });
    });
});
