import { test, expect } from '@playwright/test';

const API_URL = 'https://ship-api-ysxi.onrender.com';
const HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };

async function getTestClientId(): Promise<string> {
  const body = JSON.stringify({ name: `device-test-${Date.now()}`, redirect_uris: ['https://ship-web-ak37.onrender.com/oauth/callback'], scopes: ['documents:read'] });
  const res = await fetch(`${API_URL}/api/v1/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const data = await res.json() as Record<string, unknown>;
  return data['client_id'] as string;
}

async function issueDeviceCode(clientId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}/oauth/device/code`, { method: 'POST', headers: HEADERS, body: new URLSearchParams({ client_id: clientId, scope: 'documents:read' }) });
  return res.json() as Promise<Record<string, unknown>>;
}

async function pollToken(deviceCode: string, clientId: string): Promise<Response> {
  return fetch(`${API_URL}/oauth/token`, { method: 'POST', headers: HEADERS, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: clientId }) });
}

test.describe('device flow', () => {
  test('POST /oauth/device/code returns required fields with interval 5', async () => {
    const clientId = await getTestClientId();
    expect(clientId).toBeTruthy();
    const body = await issueDeviceCode(clientId);
    expect(body['device_code']).toBeTruthy();
    expect(body['user_code']).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(body['verification_uri']).toBeTruthy();
    expect(body['expires_in']).toBe(900);
    expect(body['interval']).toBe(5);
  });

  test('polling before approval returns authorization_pending', async () => {
    const clientId = await getTestClientId();
    expect(clientId).toBeTruthy();
    const data = await issueDeviceCode(clientId);
    const pollRes = await pollToken(data['device_code'] as string, clientId);
    expect(pollRes.status).toBe(400);
    const body = await pollRes.json() as Record<string, unknown>;
    expect(body['error']).toBe('authorization_pending');
  });

  test('slow_down on rapid polling', async () => {
    const clientId = await getTestClientId();
    expect(clientId).toBeTruthy();
    const data = await issueDeviceCode(clientId);
    const deviceCode = data['device_code'] as string;
    await pollToken(deviceCode, clientId);
    const slowRes = await pollToken(deviceCode, clientId);
    expect(slowRes.status).toBe(400);
    const body = await slowRes.json() as Record<string, unknown>;
    expect(body['error']).toBe('slow_down');
    expect(body['interval']).toBe(10);
  });

  test('full flow — approve via browser then token works on /api/v1/me', async ({ page }) => {
    const clientId = await getTestClientId();
    expect(clientId).toBeTruthy();
    const data = await issueDeviceCode(clientId);
    const deviceCode = data['device_code'] as string;
    const userCode = data['user_code'] as string;
    const verificationUri = data['verification_uri'] as string;

    await page.goto(`${verificationUri}?user_code=${userCode}`);
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page.locator('h2')).toContainText('Approved');

    const tokenRes = await pollToken(deviceCode, clientId);
    expect(tokenRes.status).toBe(200);
    const tokenBody = await tokenRes.json() as Record<string, unknown>;
    const accessToken = tokenBody['access_token'] as string;
    expect(accessToken).toBeTruthy();

    const meRes = await fetch(`${API_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(meRes.status).toBe(200);
    const me = await meRes.json() as Record<string, unknown>;
    expect(me['id']).toBeTruthy();
    expect(me['email']).toBeTruthy();
  });
});
