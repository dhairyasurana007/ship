import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const WEB_BASE_URL = process.env['SHIP_WEB_URL'] ?? 'https://ship-web-ak37.onrender.com';
const API_BASE_URL = process.env['SHIP_API_URL'] ?? 'https://ship-api-ysxi.onrender.com';

async function login(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/api/auth/login`, {
    data: { email: 'dev@ship.local', password: 'admin123' },
  });
  if (!response.ok()) {
    throw new Error(`API login failed: ${response.status()}`);
  }
  const body = await response.json() as {
    success: boolean;
    data?: { sessionToken?: string };
  };
  const sessionToken = body.data?.sessionToken;
  if (!sessionToken) {
    throw new Error('API login did not return a session token');
  }
  return sessionToken;
}

async function approveAuthorization(
  page: Page,
  request: APIRequestContext,
  authorizeUrl: URL,
): Promise<{ code: string; callbackUrl: string }> {
  const getResponse = await request.get(authorizeUrl.toString());
  expect(getResponse.ok(), 'Authorize page should load').toBeTruthy();
  const html = await getResponse.text();

  await page.setContent(html);
  await expect(page.getByRole('heading', { name: /authorize/i })).toBeVisible();

  const postResponse = await request.post(authorizeUrl.toString(), {
    form: {
      email: 'dev@ship.local',
      password: 'admin123',
      action: 'approve',
    },
  });

  const callbackUrl = postResponse.url();
  const parsed = new URL(callbackUrl);
  const code = parsed.searchParams.get('code') ?? '';
  expect(code, 'Authorization callback should include an authorization code').toBeTruthy();
  return { code, callbackUrl };
}

test('developer portal register rotate replay flow', async ({ page, request }) => {
  test.setTimeout(120_000);

  const sessionToken = await login(request);
  const authedHeaders = { 'X-Session-Id': sessionToken };

  const appName = `Portal E2E ${Date.now()}`;
  const createAppResponse = await request.post(`${API_BASE_URL}/api/v1/apps`, {
    headers: authedHeaders,
    data: {
      name: appName,
      redirect_uris: [`${WEB_BASE_URL}/oauth/callback`],
      scopes: ['documents:read', 'documents:write', 'webhooks:manage'],
    },
  });
  expect(createAppResponse.ok(), 'OAuth app create should succeed').toBeTruthy();
  const app = await createAppResponse.json() as {
    id: string;
    client_id: string;
    client_secret: string;
  };
  expect(app.client_secret).toMatch(/^[a-f0-9]{64}$/);

  const authorizeUrl = new URL('/oauth/authorize', API_BASE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', app.client_id);
  authorizeUrl.searchParams.set('redirect_uri', `${WEB_BASE_URL}/oauth/callback`);
  authorizeUrl.searchParams.set('scope', 'documents:read documents:write webhooks:manage');
  authorizeUrl.searchParams.set('code_challenge', 'challenge');
  authorizeUrl.searchParams.set('code_challenge_method', 'plain');
  authorizeUrl.searchParams.set('state', 'developer-portal-e2e');

  const authFlow = await approveAuthorization(page, request, authorizeUrl);

  const tokenResponse = await request.post(`${API_BASE_URL}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      code: authFlow.code,
      code_verifier: 'challenge',
      redirect_uri: `${WEB_BASE_URL}/oauth/callback`,
      client_id: app.client_id,
    },
  });
  expect(tokenResponse.ok(), 'OAuth token exchange should succeed').toBeTruthy();
  const tokenBody = await tokenResponse.json() as {
    access_token?: string;
    token_type?: string;
  };
  expect(tokenBody.access_token).toBeTruthy();
  expect(tokenBody.token_type).toBe('Bearer');

  const bearerHeaders = { Authorization: `Bearer ${tokenBody.access_token}` };

  const meResponse = await request.get(`${API_BASE_URL}/api/v1/me`, {
    headers: bearerHeaders,
  });
  expect(meResponse.ok(), 'Bearer token should access /me').toBeTruthy();

  const subscriptionUrl = 'https://example.com/ship-webhook-404';
  const createSubscription = await request.post(`${API_BASE_URL}/api/v1/webhooks`, {
    headers: bearerHeaders,
    data: { target_url: subscriptionUrl, event_types: ['document.created'] },
  });
  expect(createSubscription.ok(), 'Webhook subscription should succeed').toBeTruthy();

  const docTitle = `portal-e2e-${Date.now()}`;
  const createDoc = await request.post(`${API_BASE_URL}/api/v1/docs`, {
    headers: bearerHeaders,
    data: { title: docTitle },
  });
  expect(createDoc.ok(), 'Document create should succeed').toBeTruthy();

  await expect.poll(async () => {
    const deliveriesResponse = await request.get(`${API_BASE_URL}/api/v1/webhooks/deliveries`, {
      headers: bearerHeaders,
    });
    expect(deliveriesResponse.ok()).toBeTruthy();
    const body = await deliveriesResponse.json() as { data: Array<{ id: string; dead_lettered_at: string | null }> };
    return body.data.filter((row) => row.dead_lettered_at).length;
  }, { timeout: 60_000 }).toBeGreaterThan(0);

  const deliveryResponse = await request.get(`${API_BASE_URL}/api/v1/webhooks/deliveries`, {
    headers: bearerHeaders,
  });
  const deliveryBody = await deliveryResponse.json() as { data: Array<{ id: string; dead_lettered_at: string | null }> };
  const deadLetter = deliveryBody.data.find((row) => row.dead_lettered_at);
  expect(deadLetter, 'Expected at least one dead-lettered delivery').toBeTruthy();

  const replayResponse = await request.post(`${API_BASE_URL}/api/v1/webhooks/deliveries/${deadLetter?.id}/replay`, {
    headers: bearerHeaders,
  });
  expect(replayResponse.ok(), 'Replay should succeed').toBeTruthy();
});
