import { describe, it, expect } from 'vitest';

const API = process.env['API_URL'] ?? 'https://ship-api-ysxi.onrender.com';

function getTestTokens(): { access_token: string; refresh_token: string } | null {
  const at = process.env['TEST_ACCESS_TOKEN'];
  const rt = process.env['TEST_REFRESH_TOKEN'];
  if (at && rt) return { access_token: at, refresh_token: rt };
  return null;
}

describe('refresh token rotation', () => {
  it('exchanges a refresh token for a new pair', async () => {
    const tokens = getTestTokens();
    if (!tokens) {
      console.log('Skipping — TEST_REFRESH_TOKEN not set');
      return;
    }

    const res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body['access_token']).toBe('string');
    expect(typeof body['refresh_token']).toBe('string');
    expect(body['refresh_token']).not.toBe(tokens.refresh_token);
  });

  it('rejects an already-used refresh token (stolen token detection)', async () => {
    const tokens = getTestTokens();
    if (!tokens) {
      console.log('Skipping — TEST_REFRESH_TOKEN not set');
      return;
    }

    // First exchange — mark token as used
    const res1 = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(res1.status).toBe(200);
    const newTokens = await res1.json() as { access_token: string; refresh_token: string };

    // Reuse old token — should trigger family revocation
    const res2 = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(res2.status).toBe(400);
    const err = await res2.json() as Record<string, unknown>;
    expect(err['error']).toBe('invalid_grant');

    // New access token must now be rejected (family killed)
    const res3 = await fetch(`${API}/api/v1/me`, {
      headers: { Authorization: `Bearer ${newTokens.access_token}` },
    });
    expect(res3.status).toBe(401);
  });

  it('rejects an unknown refresh token with invalid_grant', async () => {
    const res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'notarealtoken' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_grant');
  });
});
