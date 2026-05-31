import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://ship-web-ak37.onrender.com' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
}

test.describe('fleetgraph on-demand context', () => {
  test('uses embedded launcher and returns context-scoped response', async ({ page }) => {
    await login(page);

    await page.route('**/api/fleetgraph/chat', async (route) => {
      const requestBody = route.request().postDataJSON() as { contextScope?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: requestBody.contextScope === 'workspace'
            ? 'Workspace status: 10 open issues and 1 active sprint.'
            : 'Issue context loaded.',
          requiresConfirm: false,
        }),
      });
    });
    await page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't' }) });
    });

    await page.getByRole('button', { name: 'FleetGraph Assistant' }).click();
    await page.getByPlaceholder('Type your message...').fill("What's at risk?");
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Workspace status: 10 open issues and 1 active sprint.')).toBeVisible({ timeout: 10000 });
  });
});
