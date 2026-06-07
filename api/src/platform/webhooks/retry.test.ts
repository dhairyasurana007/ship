import { describe, it, expect } from 'vitest';
import { FakeClock } from './IClock.js';
import { WebhookRetryScheduler } from './WebhookRetryScheduler.js';

describe('retry schedule logic (unit, FakeClock)', () => {
  it('FakeClock advances without real time', async () => {
    const clock = new FakeClock(0);
    let done = false;
    void clock.sleep(1000).then(() => { done = true; });
    expect(done).toBe(false);
    clock.advance(1000);
    await Promise.resolve(); // flush microtask queue
    expect(done).toBe(true);
  });

  it('WebhookRetryScheduler can be constructed with FakeClock', () => {
    const clock = new FakeClock(0);
    const scheduler = new WebhookRetryScheduler(clock);
    expect(scheduler).toBeDefined();
  });
});

describe('retry schedule (HTTP, prod API)', () => {
  const API = process.env['API_URL'] ?? 'https://ship-api-ysxi.onrender.com';

  it('delivery log lists attempts for an app', async () => {
    const token = process.env['TEST_WEBHOOKS_TOKEN'];
    if (!token) {
      console.log('Skipping — TEST_WEBHOOKS_TOKEN not set');
      return;
    }

    const res = await fetch(`${API}/api/v1/webhooks/deliveries`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
  });
});
