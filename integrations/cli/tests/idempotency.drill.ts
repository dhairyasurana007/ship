import { describe, it, expect } from 'vitest';

const API = process.env['API_URL'] ?? 'https://ship-api-ysxi.onrender.com';

describe('idempotency-key drill (F12b)', () => {
  it('replayed delivery preserves original idempotency key', async () => {
    const token = process.env['SHIP_GRADER_TOKEN'];
    if (!token) {
      console.log('Skipping — SHIP_GRADER_TOKEN not set');
      return;
    }

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const r1 = await fetch(`${API}/api/v1/webhooks/deliveries`, { headers });
    expect(r1.status).toBe(200);
    const body = await r1.json() as { data: Array<{ id: string; idempotency_key: string; dead_lettered_at: string | null }> };

    const dlq = body.data.find(d => d.dead_lettered_at);
    if (!dlq) {
      console.log('No dead-lettered delivery — skipping');
      return;
    }

    const originalKey = dlq.idempotency_key;

    await fetch(`${API}/api/v1/webhooks/deliveries/${dlq.id}/replay`, { method: 'POST', headers });

    const r3 = await fetch(`${API}/api/v1/webhooks/deliveries`, { headers });
    const body3 = await r3.json() as { data: Array<{ id: string; idempotency_key: string }> };
    const replayed = body3.data.find(d => d.id === dlq.id);
    expect(replayed?.idempotency_key).toBe(originalKey);
    console.log(`Idempotency key preserved: ${originalKey} ✓`);
  });
});
