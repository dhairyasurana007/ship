import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLoginFlow } from '../DeviceFlow.js';

describe('deviceLoginFlow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('discovers the OAuth client id before starting device login', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        oauth_client_id: 'client-123',
        api_base_url: 'https://ship.test',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'device-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://ship.test/oauth/device',
        expires_in: 60,
        interval: 0,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-123',
        token_type: 'Bearer',
        expires_in: 3600,
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const tokenStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const onUserCode = vi.fn();

    const accessToken = await deviceLoginFlow({
      baseUrl: 'https://ship.test',
      onUserCode,
      tokenStore,
    });

    expect(accessToken).toBe('access-123');
    expect(onUserCode).toHaveBeenCalledWith(expect.objectContaining({
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://ship.test/oauth/device',
    }));
    expect(tokenStore.save).toHaveBeenCalledWith('access-123');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL('/.well-known/ship.json', 'https://ship.test'));
  });

  it('fails with a helpful error when discovery returns HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><body>Cannot GET /.well-known/ship.json</body></html>', {
        status: 404,
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(deviceLoginFlow({
      baseUrl: 'https://ship.test',
      onUserCode: vi.fn(),
      tokenStore: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
      },
    })).rejects.toThrow(/unexpected response/i);
  });
});
