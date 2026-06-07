import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientCredentialsFlow } from '../ClientCredentialsFlow.js';

describe('clientCredentialsFlow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges a client credentials grant for an access token', async () => {
    const save = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'machine-token-123',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'documents:read documents:write',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const token = await clientCredentialsFlow({
      baseUrl: 'https://ship-api.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tokenStore: { load: async () => null, save },
    });

    expect(token).toBe('machine-token-123');
    expect(save).toHaveBeenCalledWith('machine-token-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('Expected fetch to be called once');
    }
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://ship-api.example/oauth/token');
    expect(String(init.body)).toContain('grant_type=client_credentials');
    expect(String(init.body)).toContain('client_id=client-id');
    expect(String(init.body)).toContain('client_secret=client-secret');
  });
});
