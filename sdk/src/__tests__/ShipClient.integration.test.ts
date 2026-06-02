import { describe, it, expect } from 'vitest';
import { ShipClient, ShipError } from '../index.js';

const BASE_URL = 'https://ship-api-ysxi.onrender.com';

describe('ShipClient integration', () => {
  it('throws ShipError with kind=auth on invalid token', async () => {
    const client = new ShipClient({ token: 'bad-token', baseUrl: BASE_URL });
    await expect(client.me.me()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('ShipError has correct name', async () => {
    const client = new ShipClient({ token: 'bad-token', baseUrl: BASE_URL });
    try {
      await client.me.me();
    } catch (e) {
      expect(e).toBeInstanceOf(ShipError);
      expect((e as ShipError).kind).toBe('auth');
    }
  });
});
