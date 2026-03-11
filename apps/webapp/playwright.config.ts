import { defineConfig, devices } from '@playwright/test';

/**
 * Get the port from environment variables, matching vite.config.ts.
 */
const DEFAULT_VITE_PORT = 3001;
const VITE_PORT = Number(process.env.VITE_PORT || process.env.PORT || DEFAULT_VITE_PORT);
const baseURL = `http://localhost:${VITE_PORT}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // This is now working correctly
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // You can re-add firefox, webkit, etc. here
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: baseURL, // <-- Use the dynamic URL
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      // Force mock storage for E2E tests to ensure reliable execution without real Google Auth
      VITE_USE_MOCK_STORAGE: 'remote',
    }
  },
});
