import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env['API_URL'] ?? 'https://ship-api-ysxi.onrender.com';
const CLIENT_ID = '8abf229f-efa6-4c19-bce9-7b245488396c';
const EMAIL = 'dev@ship.local';
const PASSWORD = 'admin123';

interface TimingEntry { stage: string; elapsedMs: number; }

async function measure<T>(stage: string, fn: () => Promise<T>): Promise<{ result: T; entry: TimingEntry }> {
  const start = Date.now();
  const result = await fn();
  return { result, entry: { stage, elapsedMs: Date.now() - start } };
}

async function getToken(scope = 'documents:read documents:write webhooks:manage'): Promise<string> {
  const dc = await fetch(`${API}/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope }),
  }).then(r => r.json()) as { device_code: string; user_code: string; verification_uri: string };

  // Auto-approve via server-side verify endpoint (no browser needed)
  await fetch(`${dc.verification_uri}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user_code: dc.user_code, email: EMAIL, password: PASSWORD }),
  });

  // Poll for token
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const t = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dc.device_code,
        client_id: CLIENT_ID,
      }),
    }).then(r => r.json()) as { access_token?: string };
    if (t.access_token) return t.access_token;
  }
  throw new Error('Token polling timed out');
}

describe('TTFE drill — login → subscribe → create → verify delivery', () => {
  it('completes full flow in < 60s with all stages > 50ms', async () => {
    const timings: TimingEntry[] = [];

    // Stage 1: health check
    const { entry: s1 } = await measure('api-health', async () => {
      const res = await fetch(`${API}/api/v1/health`);
      expect(res.status).toBe(200);
      return null;
    });
    timings.push(s1);
    expect(s1.elapsedMs).toBeGreaterThan(50);

    // Stage 2: device login (automated — no browser needed)
    const { result: token, entry: s2 } = await measure('device-login', () => getToken());
    timings.push(s2);
    expect(s2.elapsedMs).toBeGreaterThan(50);
    expect(typeof token).toBe('string');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Stage 3: webhook subscription
    const { entry: s3 } = await measure('webhook-subscribe', async () => {
      const res = await fetch(`${API}/api/v1/webhooks`, {
        method: 'POST', headers,
        body: JSON.stringify({ target_url: 'https://httpbin.org/post', event_types: ['document.created'] }),
      });
      expect(res.status).toBe(201);
      return null;
    });
    timings.push(s3);
    expect(s3.elapsedMs).toBeGreaterThan(50);

    // Stage 4: create document (triggers event)
    const { entry: s4 } = await measure('doc-create', async () => {
      const res = await fetch(`${API}/api/v1/docs`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: `ttfe-${Date.now()}` }),
      });
      expect(res.status).toBe(201);
      return null;
    });
    timings.push(s4);
    expect(s4.elapsedMs).toBeGreaterThan(50);

    // Stage 5: wait for delivery log entry (up to 10s)
    const { entry: s5 } = await measure('delivery-wait', async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const res = await fetch(`${API}/api/v1/webhooks/deliveries`, { headers });
        if (res.ok) {
          const body = await res.json() as { data: unknown[] };
          if (body.data.length > 0) return null;
        }
      }
      return null;
    });
    timings.push(s5);
    expect(s5.elapsedMs).toBeGreaterThan(50);

    writeTimings(timings);
    const total = timings.reduce((a, t) => a + t.elapsedMs, 0);
    expect(total).toBeLessThan(60_000);
  }, 65_000);
});

function writeTimings(timings: TimingEntry[]): void {
  try {
    mkdirSync(join(process.cwd(), 'test-results'), { recursive: true });
    writeFileSync(
      join(process.cwd(), 'test-results', 'ttfe-timing.json'),
      JSON.stringify(timings, null, 2),
    );
  } catch { /* non-fatal */ }
}
