import { test, expect } from './fixtures';
import { setupAuth } from './utils';

test.describe('Feature: E2E Chaos & Latency', () => {
    test.beforeEach(async ({ page }) => {
        await setupAuth(page);
    });

    test('should show loading indicators when storage is slow', async ({ page, mockServer }) => {
        // Apply latency BEFORE page load
        mockServer.simulateLatency(1500);
        console.log("[Test] Latency injected (1.5s)");

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        // Should show app-loading from App.tsx
        const appLoading = page.getByTestId('app-loading');
        await expect(appLoading).toBeVisible({ timeout: 5000 });
        console.log("[Test] App loading visible.");

        // Wait for finish
        await expect(appLoading).not.toBeVisible({ timeout: 15000 });

        // Now Dashboard might load its own data
        // Reset latency for this part so tests stay reasonably fast
        mockServer.simulateLatency(0);
        console.log("[Test] Latency tests passed!");
    });
});
