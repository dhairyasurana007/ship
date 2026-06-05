import { describe, it, expect } from 'vitest';

const API = process.env['API_URL'] ?? 'https://ship-api-ysxi.onrender.com';

describe('stolen token detection drill (F12a)', () => {
  it('revokes entire family when old refresh token is reused', async () => {
    const refresh = process.env['TEST_REFRESH_TOKEN'];
    if (!refresh) {
      console.log('Skipping — TEST_REFRESH_TOKEN not set');
      return;
    }

    const r1 = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    });
    expect(r1.status).toBe(200);
    const newTokens = await r1.json() as { access_token: string };

    const r2 = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as Record<string, unknown>)['error']).toBe('invalid_grant');
    console.log('Family revocation confirmed ✓');

    const r3 = await fetch(`${API}/api/v1/me`, {
      headers: { Authorization: `Bearer ${newTokens.access_token}` },
    });
    expect(r3.status).toBe(401);
    console.log('New access token killed ✓');
  });
});
