import { test, expect } from './fixtures';
import { setupAuth, ensureLoggedIn } from './utils';

/**
 * Natural Language Command & AI Integration E2E Tests
 *
 * Separates fast, deterministic, offline-first command parsing
 * (expenses and settlements) from optional LLM escalation tests.
 */

test.describe('Deterministic Command Parser (Instant, Offline-Ready, Zero-Delay)', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuth(page);
    });

    test('Deterministic Expense: parses "Add 45 for dinner", opens draft review, and commits on confirmation', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 1. Create a test group
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Deterministic Group');
        await page.getByTestId('button-submit-group').click();

        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible();
        await page.keyboard.press('Escape'); // Close share dialog
        await expect(shareTitle).not.toBeVisible();

        // 2. Open Natural Language Command Drawer
        await page.getByTestId('button-ai-assistant').click();
        await expect(page.getByTestId('drawer-title-ai')).toBeVisible();

        // 3. Submit deterministic expense command
        await page.getByPlaceholder(/Type or dictate/i).fill('Add 45 for dinner');
        await page.getByTestId('button-ai-submit').click();

        // 4. Command drawer closes immediately (no slow LLM delay)
        await expect(page.getByTestId('drawer-title-ai')).not.toBeVisible();

        // 5. Add Expense Drawer opens in Draft Review mode with human confirmation banner
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        await expect(page.getByTestId('draft-confirmation-banner')).toBeVisible();

        // 6. Verify pre-populated draft fields
        const descInput = page.getByTestId('input-expense-description');
        const amountInput = page.getByTestId('input-expense-amount');
        await expect(descInput).toHaveValue('Dinner');
        await expect(amountInput).toHaveValue('45');

        // 7. Human confirmation: click "Save Expense" to commit to ledger
        await page.getByTestId('button-submit-expense').click();

        // 8. Drawer closes and the expense is committed to the ledger
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();
        await page.getByTestId('button-nav-home').click();
        await expect(page.getByText('Dinner').first()).toBeVisible();
    });

    test('Deterministic Settlement: parses "I paid Bob 25 via cash", opens settlement modal, and records on confirmation', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        // 1. Create a test group with Bob
        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Settlement Group');
        await page.getByTestId('input-group-members').fill('Bob');
        await page.getByTestId('input-group-members').press('Enter');
        await page.getByTestId('button-submit-group').click();

        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible();

        // 2. Open Natural Language Command Drawer
        await page.getByTestId('button-ai-assistant').click();
        await expect(page.getByTestId('drawer-title-ai')).toBeVisible();

        // 3. Submit deterministic settlement command
        await page.getByPlaceholder(/Type or dictate/i).fill('I paid Bob 25 via cash');
        await page.getByTestId('button-ai-submit').click();

        // 4. Command drawer closes immediately
        await expect(page.getByTestId('drawer-title-ai')).not.toBeVisible();

        // 5. SettlementModal opens in Draft Review mode
        await expect(page.getByTestId('modal-settlement')).toBeVisible();
        await expect(page.getByTestId('settlement-draft-banner')).toBeVisible();

        // 6. Verify pre-populated amount
        const amountInput = page.getByTestId('input-settlement-amount');
        await expect(amountInput).toHaveValue(/25(\.00)?/);

        // 7. Confirm settlement recording
        await page.getByTestId('button-record-payment').click();
        await expect(page.getByTestId('modal-settlement')).not.toBeVisible();
    });

    test('Deterministic Spanish Language: parses "Pagué 30 almuerzo" without LLM calls', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Spanish Group');
        await page.getByTestId('button-submit-group').click();

        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible();

        await page.getByTestId('button-ai-assistant').click();
        await page.getByPlaceholder(/Type or dictate/i).fill('Pagué 30 almuerzo');
        await page.getByTestId('button-ai-submit').click();

        await expect(page.getByTestId('drawer-title-ai')).not.toBeVisible();
        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        await expect(page.getByTestId('draft-confirmation-banner')).toBeVisible();

        await expect(page.getByTestId('input-expense-description')).toHaveValue('Almuerzo');
        await expect(page.getByTestId('input-expense-amount')).toHaveValue('30');

        await page.getByTestId('button-submit-expense').click();
        await expect(page.getByTestId('drawer-title-add-expense')).not.toBeVisible();
        await page.getByTestId('button-nav-home').click();
        await expect(page.getByText('Almuerzo').first()).toBeVisible();
    });
});

test.describe('Optional LLM Escalation Suite (Isolated Mock AI Calls)', () => {
    let llmCallCount = 0;

    test.beforeEach(async ({ page }) => {
        llmCallCount = 0;

        // Mock Proxy Health Check
        const proxyHealthMock = async (route: any) => {
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: 'Quozen AI Proxy is Running'
            });
        };
        await page.route('http://localhost:8788', proxyHealthMock);
        await page.route('http://localhost:8788/**', proxyHealthMock);
        await page.route('**/health', proxyHealthMock);

        // Mock Proxy Chat Route
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

            llmCallCount++;
            await route.fulfill({
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                contentType: 'application/json',
                body: JSON.stringify({
                    description: 'Refined Gourmet Dinner',
                    amount: 75,
                    category: 'food_dining',
                    splitStrategy: 'equally_everyone'
                })
            });
        });

        await setupAuth(page);
    });

    test('LLM Escalation: "Refine with AI" button contacts LLM provider only on user escalation', async ({ page }) => {
        await page.goto('/groups');
        await ensureLoggedIn(page);

        await page.getByTestId('button-empty-create-group').or(page.getByTestId('button-new-group')).first().click();
        await page.getByTestId('input-group-name').fill('Escalation Group');
        await page.getByTestId('button-submit-group').click();

        const shareTitle = page.getByTestId('drawer-title-share');
        await expect(shareTitle).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(shareTitle).not.toBeVisible();

        // 1. Initial parse runs deterministically with 0 LLM calls
        await page.getByTestId('button-ai-assistant').click();
        await page.getByPlaceholder(/Type or dictate/i).fill('dinner 50');
        await page.getByTestId('button-ai-submit').click();

        await expect(page.getByTestId('drawer-title-add-expense')).toBeVisible();
        await expect(page.getByTestId('draft-confirmation-banner')).toBeVisible();

        // Verify no LLM call was issued for initial deterministic parse
        expect(llmCallCount).toBe(0);

        // 2. User explicitly clicks "Refine with AI"
        const refineButton = page.getByTestId('button-refine-with-ai');
        await expect(refineButton).toBeVisible();
        const chatPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/agent/chat'));
        await refineButton.click();
        await chatPromise;
        // Verify LLM endpoint was contacted
        expect(llmCallCount).toBeGreaterThanOrEqual(1);
    });
});
