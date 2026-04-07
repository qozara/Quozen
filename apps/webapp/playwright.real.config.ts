import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * Config for running E2E tests against the REAL Google Drive API headless.
 */
export default defineConfig({
  ...baseConfig,

  // CRITICAL: Cloud tests MUST run sequentially.
  // Hitting the real Google Drive API with 4 parallel workers concurrently mutating
  // the same quozen-settings.json file causes massive race conditions and 429 Rate Limits.
  fullyParallel: false,
  workers: 1,

  // ONLY run the tests specifically designed to hit real Google Drive APIs
  testMatch: ['**/reproduce_issues.spec.ts'],

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  // Override webServer to NOT use mock storage
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001', // Hardcoding for simplicity or use logic from base
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_USE_MOCK_STORAGE: 'false',
    }
  },
});
