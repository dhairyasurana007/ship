import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://ship-web-ak37.onrender.com' });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
}

test.describe('fleetgraph human gate', () => {
  test('renders pending approval cards and sends approval actions', async ({ page }) => {
    await login(page);

    let approvalStatus = 'pending';
    await page.route('**/api/fleetgraph/approvals/pending', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approvals: [{ id: 'a1', mutation_type: 'move_issue_sprint', status: approvalStatus }],
        }),
      });
    });
    await page.route('**/api/fleetgraph/approvals/a1/approve', async (route) => {
      approvalStatus = 'approved';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/fleetgraph/approvals/a1/reject', async (route) => {
      approvalStatus = 'rejected';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/fleetgraph/approvals/a1/execute', async (route) => {
      approvalStatus = 'executed';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 't' }) });
    });

    const panel = page.locator('[data-fleetgraph-panel]');
    await page.getByRole('button', { name: 'FleetGraph Assistant' }).click();
    await expect(panel).toContainText('Pending approvals');
    await expect(panel).toContainText('Move issue to sprint new sprint');

    // Click the approval item to open detail view, then approve
    await panel.getByText('Move issue to sprint new sprint').click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    // Detail view closes after approval
    await expect(page.getByRole('button', { name: 'Approve' })).not.toBeVisible();
  });
});
