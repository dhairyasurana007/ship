import { expect, test, type Page } from '@playwright/test';

const WEB_BASE_URL = process.env['SHIP_WEB_URL'] ?? 'https://ship-web-ak37.onrender.com';

async function login(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ship:disableActionItemsModal', 'true');
  });
  await page.goto(`${WEB_BASE_URL}/login`);
  await page.getByLabel('Email address').fill('dev@ship.local');
  await page.getByLabel('Password').fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    const response = await fetch('/api/accountability/action-items', { credentials: 'include' });
    if (!response.ok) return;
    const body = await response.json() as { items?: Array<{ id: string }> };
    const seenIds = (body.items ?? []).map((item) => item.id);
    localStorage.setItem('ship:seenActionItemIds', JSON.stringify(seenIds));
    localStorage.setItem('ship:disableActionItemsModal', 'true');
  });
}

test('developer portal register rotate replay flow', async ({ page }) => {
  test.setTimeout(120_000);

  await login(page);
  await page.goto(`${WEB_BASE_URL}/developer`);

  await expect(page.getByText('OAuth Apps')).toBeVisible();
  await expect(page.getByText('Developer Portal')).toBeVisible();

  // Apps
  await page.locator('button:has-text("Register App")').first().evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
  await expect(page.getByPlaceholder('App name')).toBeVisible();
  await page.getByPlaceholder('App name').fill(`Portal E2E ${Date.now()}`);
  await page.locator('button:has-text("Create")').last().evaluate((el) => {
    (el as HTMLButtonElement).click();
  });

  const secretDialog = page.getByRole('dialog');
  await expect(secretDialog).toContainText('Client Secret (shown once):');
  const firstSecret = (await secretDialog.locator('code').textContent())?.trim();
  expect(firstSecret).toMatch(/^[a-f0-9]{64}$/);

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(secretDialog).toBeHidden();

  const appRow = page.getByRole('row').filter({ hasText: 'Portal E2E' }).first();
  await expect(appRow).toBeVisible();
  await appRow.getByRole('button', { name: 'Rotate Secret' }).click();
  await expect(secretDialog).toContainText('Client Secret (shown once):');
  const rotatedSecret = (await secretDialog.locator('code').textContent())?.trim();
  expect(rotatedSecret).toMatch(/^[a-f0-9]{64}$/);
  expect(rotatedSecret).not.toEqual(firstSecret);
  await page.getByRole('button', { name: 'Close' }).click();

  // Subscriptions
  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await page.getByPlaceholder('https://example.com/webhooks/ship').fill('https://example.com/ship-webhook-404');
  await page.getByRole('button', { name: 'Create Subscription' }).click();
  await expect(page.getByRole('table')).toContainText('https://example.com/ship-webhook-404');

  const token = await page.evaluate(() => localStorage.getItem('ship_token'));
  expect(token).toBeTruthy();

  const docTitle = `portal-e2e-${Date.now()}`;
  await page.evaluate(async ({ tokenValue, title }) => {
    const response = await fetch('/api/v1/docs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(`create document failed: ${response.status}`);
    }
  }, { tokenValue: token, title: docTitle });

  // Delivery log
  await page.getByRole('button', { name: 'Delivery Log' }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(async () => page.getByRole('row').count(), { timeout: 30_000 }).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Dead Letters' }).click();
  await expect.poll(async () => page.getByRole('button', { name: 'Replay' }).count(), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Replay' }).first().click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Replay' }).first()).toBeVisible();
});
