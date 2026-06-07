import { test, expect } from './fixtures/isolated-env'

test.describe('SDK page', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('login page shows Developer? link that navigates to /sdk', async ({ page }) => {
    await page.goto('/login')

    const devLink = page.getByRole('link', { name: 'Developer?' })
    await expect(devLink).toBeVisible({ timeout: 5000 })
    await devLink.click()

    await expect(page).toHaveURL('/sdk', { timeout: 5000 })
  })

  test('SDK page loads with Ship SDK heading', async ({ page }) => {
    await page.goto('/sdk')

    await expect(page.getByRole('heading', { name: 'Ship SDK' })).toBeVisible({ timeout: 5000 })
  })

  test('Back to sign in link navigates to /login', async ({ page }) => {
    await page.goto('/sdk')

    const backLink = page.getByRole('link', { name: 'Back to sign in' })
    await expect(backLink).toBeVisible({ timeout: 5000 })
    await backLink.click()

    await expect(page).toHaveURL('/login', { timeout: 5000 })
  })

  test('page shows npm install command', async ({ page }) => {
    await page.goto('/sdk')

    await expect(page.getByText('npm install @ship-dhairya/sdk')).toBeVisible({ timeout: 5000 })
  })

  test('page shows SDK TypeScript usage with ShipClient import', async ({ page }) => {
    await page.goto('/sdk')

    await expect(page.getByText("import { ShipClient } from '@ship-dhairya/sdk'")).toBeVisible({ timeout: 5000 })
  })

  test('all sections are present', async ({ page }) => {
    await page.goto('/sdk')

    await expect(page.getByRole('heading', { name: 'Quick start' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'CLI usage' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'SDK usage (TypeScript)' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Requirements' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Minimal end-to-end flow' })).toBeVisible({ timeout: 5000 })
  })

  test('SDK page is accessible without authentication', async ({ page }) => {
    await page.goto('/sdk')

    // Should not redirect to login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 })

    // Should show the SDK page content
    await expect(page.getByRole('heading', { name: 'Ship SDK' })).toBeVisible({ timeout: 5000 })
  })
})
