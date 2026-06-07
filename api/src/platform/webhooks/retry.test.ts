import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from './IClock.js';

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  pool: {
    query: poolQuery,
  },
}));

import { retryScheduler, WebhookRetryScheduler } from './WebhookRetryScheduler.js';

type DeliveryRow = {
  id: string;
  subscription_id: string;
  payload: string;
  idempotency_key: string;
  attempt_number: number;
  target_url: string;
  signing_secret: string;
};

function makeRow(attempt_number: number): DeliveryRow {
  return {
    id: 'delivery-1',
    subscription_id: 'sub-1',
    payload: JSON.stringify({ event_type: 'document.created', data: { id: 'doc-1' } }),
    idempotency_key: 'key-1',
    attempt_number,
    target_url: 'https://example.test/webhook',
    signing_secret: 'secret-1',
  };
}

describe('retry schedule logic (unit, FakeClock)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
  });

  it('FakeClock advances without real time', async () => {
    const clock = new FakeClock(0);
    let done = false;
    void clock.sleep(1000).then(() => {
      done = true;
    });
    expect(done).toBe(false);
    clock.advance(1000);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('walks a delivery through retries, dead-lettering, and replay', async () => {
    const clock = new FakeClock(0);
    const scheduler = new WebhookRetryScheduler(clock);
    const fetchMock = vi.mocked(globalThis.fetch);
    let currentAttempt = 1;

    poolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT wd.id')) {
        return { rows: [makeRow(currentAttempt)] };
      }

      return { rows: [], rowCount: 1 };
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await scheduler.processDue();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.test/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'key-1',
          'Ship-Signature': expect.any(String),
        }),
        body: expect.any(String),
      }),
    );
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET response_status=$1, latency_ms=$2, attempt_number=$3, next_attempt_at=$4'),
      expect.arrayContaining([500, 0, 2, expect.any(Date), 'delivery-1']),
    );
    currentAttempt = 2;

    poolQuery.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await scheduler.processDue();

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET response_status=$1, latency_ms=$2, attempt_number=$3, next_attempt_at=$4'),
      expect.arrayContaining([503, 0, 3, expect.any(Date), 'delivery-1']),
    );
    currentAttempt = 3;

    poolQuery.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 422 }));
    await scheduler.processDue();

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET response_status=$1, latency_ms=$2, dead_lettered_at=NOW(), next_attempt_at=NULL, attempt_number=$3'),
      [422, 0, 3, 'delivery-1'],
    );

    poolQuery.mockClear();
    await scheduler.replay('delivery-1');

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET dead_lettered_at=NULL, next_attempt_at=NOW(), attempt_number=1'),
      ['delivery-1'],
    );
    currentAttempt = 1;

    poolQuery.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await scheduler.processDue();

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET response_status=$1, latency_ms=$2, next_attempt_at=NULL'),
      [204, 0, 'delivery-1'],
    );
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
      console.log('Skipping â€” TEST_WEBHOOKS_TOKEN not set');
      return;
    }

    const res = await fetch(`${API}/api/v1/webhooks/deliveries`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body['data'])).toBe(true);
  });
});
