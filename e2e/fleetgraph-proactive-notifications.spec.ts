import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://ship-web-ak37.onrender.com' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
}

test.describe('fleetgraph proactive notifications', () => {
  test('shows recent proactive alerts in launcher', async ({ page }) => {
    await login(page);

    await page.route('**/api/fleetgraph/outputs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          outputs: [
            {
              id: 'o1',
              title: 'FleetGraph: stale_issue',
              message: 'Issue has not progressed recently (72h stale).',
              condition_type: 'stale_issue',
            },
          ],
        }),
      });
    });

    const panel = page.locator('[data-fleetgraph-panel]');
    await page.getByRole('button', { name: 'FleetGraph Assistant' }).click();
    await expect(panel).toContainText('FleetGraph alerts (1)', { timeout: 10000 });
    await expect(panel).toContainText('FleetGraph: stale_issue');
  });
});
