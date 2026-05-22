import WebSocket from 'ws';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { createHttpClient } from '../http-client.js';

const TEST_USER_EMAIL = `probe-ws-${Date.now()}@probe.local`;
const TEST_USER_PASSWORD = 'ProbePass123!';

type ConnectResult = { ws: WebSocket; httpStatus?: number; error?: string };

let connectImpl: (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
) => Promise<ConnectResult> = connect;

let serverAliveImpl: (target: string, timeout: number) => Promise<boolean> = serverAlive;

export function __setWsConnectForTests(
  fn: ((url: string, headers: Record<string, string>, timeoutMs: number) => Promise<ConnectResult>) | null
): void {
  connectImpl = fn ?? connect;
}

export function __setServerAliveForTests(
  fn: ((target: string, timeout: number) => Promise<boolean>) | null
): void {
  serverAliveImpl = fn ?? serverAlive;
}

function wsBase(target: string): string {
  return target.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

async function elevateBootstrapUser(target: string, email: string): Promise<void> {
  const token = process.env.PROBE_INTERNAL_ELEVATION_TOKEN;
  if (!token) {
    console.log('WebSocket probe: PROBE_INTERNAL_ELEVATION_TOKEN not set; skipping internal admin elevation call.');
    return;
  }

  console.log('WebSocket probe: requesting internal bootstrap admin elevation...');
  const res = await fetch(`${target}/api/internal/probe/elevate-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ email, ttlMinutes: 10 })
  });
  console.log(`WebSocket probe elevate-admin response: HTTP ${res.status}`);
}

async function serverAlive(target: string, timeout: number): Promise<boolean> {
  try {
    const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch {
    return false;
  }
}

function connect(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ ws });
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      resolve({ ws, httpStatus: res.statusCode });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ws, error: err.message });
    });
  });
}

function finding(
  id: string,
  title: string,
  vulnerable: boolean,
  severity: Finding['severity'],
  description: string,
  reproduction: string,
  expected: string,
  actual: string,
  remediation: string
): Finding {
  return {
    id,
    category: 'websocket',
    title,
    severity,
    status: vulnerable ? 'vulnerable' : 'pass',
    description,
    reproduction,
    evidence: { expected, actual },
    remediation
  };
}

function inconclusive(
  id: string,
  title: string,
  description: string,
  expected: string,
  actual: string
): Finding {
  return {
    id,
    category: 'websocket',
    title,
    severity: 'info',
    status: 'inconclusive',
    description,
    reproduction: 'See probe logs.',
    evidence: { expected, actual },
    remediation: 'Validate environment and rerun the probe.'
  };
}

export async function probeWebSocket(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];
  const base = wsBase(config.target);
  const admin = createHttpClient(config);
  const bootstrapCreds = {
    email: `probe-ws-bootstrap-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@probe.local`,
    password: `ProbePass!${Date.now()}`
  };

  console.log(`WebSocket probe bootstrap email: ${bootstrapCreds.email}`);
  console.log(`WebSocket probe bootstrap password: ${bootstrapCreds.password}`);
  console.log('WebSocket probe: attempting bootstrap auto-register...');
  try {
    const registerRes = await fetch(`${config.target}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bootstrapCreds)
    });
    console.log(`WebSocket probe bootstrap register response: HTTP ${registerRes.status}`);
    await elevateBootstrapUser(config.target, bootstrapCreds.email);
  } catch (err) {
    console.log(
      `WebSocket probe bootstrap register failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await new Promise((r) => setTimeout(r, 1500));
  const adminLoggedIn = await admin.login(bootstrapCreds.email, bootstrapCreds.password);
  if (!adminLoggedIn) {
    return [
      inconclusive(
        'WS-000',
        'Bootstrap login failed for WebSocket probe',
        'Could not authenticate bootstrap session required for WS tests.',
        'Successful bootstrap login',
        'Bootstrap login failed'
      )
    ];
  }

  let docId: string | null = null;
  let privateDocId: string | null = null;
  let testUserId: string | null = null;

  try {
    const dr = await admin.post('/api/documents', { title: 'probe-ws', document_type: 'wiki' });
    if (dr.ok) {
      try {
        const body = (await dr.json()) as { data?: { id?: string }; id?: string };
        docId = body?.data?.id ?? body?.id ?? null;
      } catch {
        docId = null;
      }
    }

    const pr = await admin.post('/api/documents', {
      title: 'probe-ws-private',
      document_type: 'wiki',
      visibility: 'private'
    });
    if (pr.ok) {
      try {
        const body = (await pr.json()) as { data?: { id?: string }; id?: string };
        privateDocId = body?.data?.id ?? body?.id ?? null;
      } catch {
        privateDocId = null;
      }
    }

    const ur = await admin.post('/api/admin/users', {
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      role: 'member'
    });
    if (ur.ok) {
      try {
        const body = (await ur.json()) as { data?: { id?: string }; id?: string };
        testUserId = body?.data?.id ?? body?.id ?? null;
      } catch {
        testUserId = null;
      }
    }

    const cookie = admin.getSessionCookieHeader();
    const wsUrl = docId ? `${base}/collaboration/wiki:${docId}` : `${base}/collaboration/wiki:probe`;

    {
      const { httpStatus } = await connectImpl(wsUrl, {}, config.timeout);
      results.push(
        finding(
          'WS-001',
          'Unauthenticated WebSocket connection accepted',
          !(httpStatus === 401 || httpStatus === 403),
          'high',
          'WS upgrade without auth should be rejected.',
          `Connect to ${wsUrl} with no Cookie header.`,
          'HTTP 401 or 403 during upgrade',
          httpStatus ? `HTTP ${httpStatus}` : 'Connection opened',
          'Validate session cookie during WebSocket upgrade.'
        )
      );
    }

    {
      const { httpStatus, ws } = await connectImpl(
        `${base}/collaboration/wiki:nonexistent-probe-00000`,
        { Cookie: cookie },
        config.timeout
      );
      ws.terminate();
      results.push(
        finding(
          'WS-002',
          'WebSocket accepts non-existent document',
          !(httpStatus && httpStatus >= 400),
          'medium',
          'Non-existent doc IDs should be rejected.',
          `Connect to ${base}/collaboration/wiki:nonexistent-probe-00000 with valid auth.`,
          'HTTP 4xx rejection',
          httpStatus ? `HTTP ${httpStatus}` : 'Connection opened',
          'Validate document existence before upgrade completion.'
        )
      );
    }

    {
      const { ws } = await connectImpl(wsUrl, { Cookie: cookie }, config.timeout);
      ws.send(Buffer.alloc(11 * 1024 * 1024));
      await new Promise((r) => setTimeout(r, 2000));
      ws.terminate();
      const alive = await serverAliveImpl(config.target, config.timeout);
      results.push(
        finding(
          'WS-003',
          'Oversized WS message can crash server',
          !alive,
          'critical',
          'Large WS payloads should not crash server.',
          'Send 11MB binary message then check /health.',
          'Server remains healthy',
          `serverAlive: ${alive}`,
          'Enforce strict message size limits and safe parsing.'
        )
      );
    }

    {
      const { ws } = await connectImpl(wsUrl, { Cookie: cookie }, config.timeout);
      const bytes = Buffer.alloc(260);
      bytes[0] = 0xff;
      bytes[1] = 0xfe;
      ws.send(bytes);
      await new Promise((r) => setTimeout(r, 1000));
      ws.terminate();
      const alive = await serverAliveImpl(config.target, config.timeout);
      results.push(
        finding(
          'WS-004',
          'Malformed WS frames can crash server',
          !alive,
          'high',
          'Malformed frames should be rejected without instability.',
          'Send malformed binary frame then check /health.',
          'Server remains healthy',
          `serverAlive: ${alive}`,
          'Harden WS frame parsing and protocol validation.'
        )
      );
    }

    {
      const { ws } = await connectImpl(wsUrl, { Cookie: cookie }, config.timeout);
      ws.send(Buffer.from([99]));
      await new Promise((r) => setTimeout(r, 1000));
      ws.terminate();
      const alive = await serverAliveImpl(config.target, config.timeout);
      results.push(
        finding(
          'WS-005',
          'Unknown WS message types can crash server',
          !alive,
          'high',
          'Unknown protocol types should be safely ignored/rejected.',
          'Send WS message type 99 then check /health.',
          'Server remains healthy',
          `serverAlive: ${alive}`,
          'Validate protocol message type before processing.'
        )
      );
    }

    {
      const attempts = Array.from({ length: 35 }, () =>
        connectImpl(wsUrl, { Cookie: cookie }, config.timeout)
      );
      const resolved = await Promise.all(attempts);
      const got429 = resolved.some((r) => r.httpStatus === 429);
      resolved.forEach((r) => r.ws.terminate());
      results.push(
        finding(
          'WS-006',
          'WebSocket connection flood not rate-limited',
          !got429,
          'high',
          'Rapid WS connection floods should be rate-limited.',
          'Open 35 WS connections in rapid succession.',
          'At least one HTTP 429 during upgrades',
          got429 ? 'Observed HTTP 429' : 'No HTTP 429 observed',
          'Add connection-rate limiter for WS upgrades.'
        )
      );
    }

    {
      const { ws } = await connectImpl(wsUrl, { Cookie: cookie }, config.timeout);
      let closed = false;
      ws.on('close', () => {
        closed = true;
      });
      for (let i = 0; i < 60; i++) {
        ws.send(Buffer.alloc(0));
      }
      await new Promise((r) => setTimeout(r, 1000));
      ws.terminate();
      results.push(
        finding(
          'WS-007',
          'WebSocket message flood not throttled',
          !closed,
          'medium',
          'Burst message floods should close offending connection.',
          'Send 60 empty WS frames in under 1 second.',
          'Connection closes',
          closed ? 'Connection closed' : 'Connection remained open',
          'Add per-connection message-rate enforcement.'
        )
      );
    }

    if (privateDocId && testUserId) {
      const member = createHttpClient(config);
      const memberLoggedIn = await member.login(TEST_USER_EMAIL, TEST_USER_PASSWORD);
      const memberCookie = member.getSessionCookieHeader();
      const { httpStatus, ws } = await connectImpl(
        `${base}/collaboration/wiki:${privateDocId}`,
        memberLoggedIn ? { Cookie: memberCookie } : {},
        config.timeout
      );
      ws.terminate();
      await member.logout();
      results.push(
        finding(
          'WS-008',
          'Member can connect to private document WebSocket',
          httpStatus !== 403,
          'critical',
          'User without access should be rejected during WS upgrade.',
          `Login as member, connect to private doc WS /collaboration/wiki:${privateDocId}.`,
          'HTTP 403 during upgrade',
          httpStatus ? `HTTP ${httpStatus}` : 'Connection opened',
          'Apply document ACL checks during WS upgrade.'
        )
      );
    } else {
      results.push(
        inconclusive(
          'WS-008',
          'Private document access-control WS test not run',
          'Missing private document or member user prevented WS-008 execution.',
          'Private doc + member user available',
          'Required setup could not be completed'
        )
      );
    }
  } catch (err: unknown) {
    results.push(
      inconclusive(
        'WS-ERR',
        'WebSocket probe failed',
        'Unexpected error while running WS tests.',
        'All WS tests execute',
        err instanceof Error ? err.message : String(err)
      )
    );
  } finally {
    if (docId) await admin.del(`/api/documents/${docId}`).catch(() => {});
    if (privateDocId) await admin.del(`/api/documents/${privateDocId}`).catch(() => {});
    if (testUserId) await admin.del(`/api/admin/users/${testUserId}`).catch(() => {});
    await admin.logout();
  }

  return results;
}
