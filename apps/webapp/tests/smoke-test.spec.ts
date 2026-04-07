import { test, expect } from './fixtures';

test('homepage redirects to login and has correct title', async ({ page }) => {
  // Go to the root URL
  await page.goto('/');

  // 1. Check if the title is correct (which we just fixed)
  await expect(page).toHaveTitle(/Quozen: Expense Sharing/);

  // 2. Check that the page redirected to /login
  await expect(page).toHaveURL(/.*login/);

  // 3. Check for an element that is unique to the login page
  const googleLoginButton = page.getByRole('button', { name: /Continue with Google/i });
  await expect(googleLoginButton).toBeVisible();
});
