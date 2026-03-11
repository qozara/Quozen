import { test, expect } from '@playwright/test';
import { setupAuth, ensureLoggedIn, resetTestState, setupTestEnvironment } from './utils';
import { mockServer } from './mock-server';

test.describe('Feature: E2E Chaos & Latency', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestState();
        await setupTestEnvironment(page.context());
        await setupAuth(page);
    });

    test('should show loading indicators when storage is slow', async ({ page }) => {
        // Apply latency BEFORE page load
        mockServer.simulateLatency(5000); 
        console.log("[Test] Latency injected (5s)");

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        // Should show "Loading Application..." from App.tsx
        const appLoading = page.getByText(/Loading Application/i);
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
