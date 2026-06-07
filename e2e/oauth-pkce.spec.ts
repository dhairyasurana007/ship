import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const API_URL = 'https://ship-api-ysxi.onrender.com';
const WEB_URL = 'https://ship-web-ak37.onrender.com';

// PKCE helpers
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function registerTestApp(): Promise<{ clientId: string; appId: string }> {
  const res = await fetch(`${API_URL}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `pkce-test-${Date.now()}`,
      redirect_uris: [`${WEB_URL}/oauth/callback`],
      scopes: ['documents:read'],
    }),
  });
  const data = await res.json() as any;
  return { clientId: data.client_id, appId: data.id };
}

test.describe('OAuth PKCE flow', () => {
  test('happy path — valid code_verifier returns access token', async ({ page }) => {
    const { clientId } = await registerTestApp();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Navigate to consent screen
    const authorizeUrl = new URL(`${API_URL}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', `${WEB_URL}/oauth/callback`);
    authorizeUrl.searchParams.set('scope', 'documents:read');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);

    await page.goto(authorizeUrl.toString());
    await expect(page.locator('h2')).toContainText('Authorize');

    // Fill credentials and approve
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');

    // Intercept the redirect to capture the code
    const redirectPromise = page.waitForURL(/\/oauth\/callback/);
    await page.click('button[value="approve"]');

    let code: string;
    try {
      await redirectPromise;
      const url = new URL(page.url());
      code = url.searchParams.get('code') ?? '';
      expect(url.searchParams.get('state')).toBe(state);
    } catch {
      // Redirect may go to a URL the browser can't load — extract from navigation
      const url = new URL(page.url());
      code = url.searchParams.get('code') ?? '';
    }

    expect(code).toBeTruthy();
    expect(code.length).toBe(64);

    // Exchange code for token
    const tokenRes = await fetch(`${API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: `${WEB_URL}/oauth/callback`,
        client_id: clientId,
      }),
    });

    expect(tokenRes.status).toBe(200);
    const tokenData = await tokenRes.json() as any;
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.token_type).toBe('Bearer');
  });

  test('negative case — wrong code_verifier returns invalid_grant', async ({ page }) => {
    const { clientId } = await registerTestApp();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    const authorizeUrl = new URL(`${API_URL}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', `${WEB_URL}/oauth/callback`);
    authorizeUrl.searchParams.set('scope', 'documents:read');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);

    await page.goto(authorizeUrl.toString());
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');

    let code = '';
    try {
      await Promise.all([
        page.waitForURL(/\/oauth\/callback/),
        page.click('button[value="approve"]'),
      ]);
      const url = new URL(page.url());
      code = url.searchParams.get('code') ?? '';
    } catch {
      const url = new URL(page.url());
      code = url.searchParams.get('code') ?? '';
    }

    expect(code).toBeTruthy();

    // Use WRONG verifier
    const tokenRes = await fetch(`${API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-that-will-not-match',
        redirect_uri: `${WEB_URL}/oauth/callback`,
        client_id: clientId,
      }),
    });

    expect(tokenRes.status).toBe(400);
    const body = await tokenRes.json() as any;
    expect(body.error).toBe('invalid_grant');
  });
});
