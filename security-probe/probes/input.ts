import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { createHttpClient } from '../http-client.js';
import { registerCleanupTask } from '../cleanup.js';
import { getApiTarget } from '../targets.js';

type PayloadType = 'xss-stored' | 'xss-reflected' | 'sqli' | 'overflow' | 'null-byte' | 'path-traversal';
type Payload = { id: string; type: PayloadType; value: string };
type Endpoint = {
  index: number;
  path: string;
  field: string;
  body: (value: string) => Record<string, unknown>;
  getPath: (id: string) => string;
};

const PAYLOADS: Payload[] = [
  { id: '01', type: 'xss-stored', value: '<script>alert("probe-xss")</script>' },
  { id: '02', type: 'xss-reflected', value: '<img src=x onerror=alert("probe-xss-reflected")>' },
  { id: '03', type: 'sqli', value: `' OR 1=1 --` },
  { id: '04', type: 'sqli', value: `'; DROP TABLE users; --` },
  { id: '05', type: 'overflow', value: 'A'.repeat(16384) },
  { id: '06', type: 'null-byte', value: 'probe%00title' },
  { id: '07', type: 'path-traversal', value: '../../etc/passwd' },
  { id: '08', type: 'xss-stored', value: '<svg><script>alert(1)</script></svg>' },
  { id: '09', type: 'xss-reflected', value: '"><script>alert(document.domain)</script>' },
  { id: '10', type: 'overflow', value: 'B'.repeat(65536) }
];

const ENDPOINTS: Endpoint[] = [
  {
    index: 1,
    path: '/api/documents',
    field: 'title',
    body: (v: string) => ({ title: v, document_type: 'wiki' }),
    getPath: (id: string) => `/api/documents/${id}`
  },
  {
    index: 2,
    path: '/api/issues',
    field: 'title',
    body: (v: string) => ({ title: v }),
    getPath: (id: string) => `/api/issues/${id}`
  },
  {
    index: 3,
    path: '/api/projects',
    field: 'name',
    body: (v: string) => ({ name: v }),
    getPath: (id: string) => `/api/projects/${id}`
  }
];

const SQL_PATTERNS = ['syntax error', ' sql', 'pg error', 'column', 'relation', 'error:', 'invalid input'];
const LEAK_PATTERNS = ['at object.', 'at module.', '/app/', '/home/', 'c:\\'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function elevateBootstrapUser(target: string, email: string): Promise<void> {
  const token = process.env.PROBE_INTERNAL_ELEVATION_TOKEN;
  if (!token) {
    console.log('Input probe: PROBE_INTERNAL_ELEVATION_TOKEN not set; skipping internal admin elevation call.');
    return;
  }
  console.log('Input probe: requesting internal bootstrap admin elevation...');
  const res = await fetch(`${target}/api/internal/probe/elevate-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ email, ttlMinutes: 10 })
  });
  console.log(`Input probe elevate-admin response: HTTP ${res.status}`);
}

function isVulnerable(type: PayloadType, value: string, status: number, body: string): boolean {
  const lower = body.toLowerCase();
  if (type === 'xss-stored' || type === 'xss-reflected') return body.includes(value);
  if (type === 'sqli') return status === 500 || SQL_PATTERNS.some((p) => lower.includes(p));
  if (type === 'overflow') return status === 500;
  return status === 500 || LEAK_PATTERNS.some((p) => lower.includes(p));
}

function severityForType(type: PayloadType): Finding['severity'] {
  if (type === 'sqli') return 'critical';
  if (type.startsWith('xss')) return 'high';
  return 'low';
}

export async function probeInput(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];
  const apiTarget = getApiTarget(config);
  const client = createHttpClient(config);
  const bootstrapCreds = {
    email: `probe-input-bootstrap-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@probe.local`,
    password: `ProbePass!${Date.now()}`
  };

  console.log(`Input probe bootstrap email: ${bootstrapCreds.email}`);
  console.log(`Input probe bootstrap password: ${bootstrapCreds.password}`);
  console.log('Input probe: attempting bootstrap auto-register...');

  try {
    const registerRes = await fetch(`${apiTarget}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bootstrapCreds)
    });
    console.log(`Input probe bootstrap register response: HTTP ${registerRes.status}`);
    await elevateBootstrapUser(apiTarget, bootstrapCreds.email);
  } catch (err: unknown) {
    console.log(
      `Input probe bootstrap register failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await sleep(1500);
  const loggedIn = await client.login(bootstrapCreds.email, bootstrapCreds.password);
  if (!loggedIn) {
    return [
      {
        id: 'INP-000',
        category: 'input',
        title: 'Bootstrap login failed for input probe',
        severity: 'info',
        status: 'inconclusive',
        description: 'Could not authenticate bootstrap session required for input tests.',
        reproduction: 'Check /api/auth/register and /api/auth/login availability.',
        evidence: {
          expected: 'HTTP 200 from POST /api/auth/login with generated credentials',
          actual: 'Bootstrap login failed'
        },
        remediation: 'Ensure bootstrap register/login flow works and rerun.'
      }
    ];
  }

  const created: Array<{ deletePath: string }> = [];

  try {
    for (const ep of ENDPOINTS) {
      for (const payload of PAYLOADS) {
        const id = `INP-${ep.index}-${payload.id}`;
        try {
          const res = await client.post(ep.path, ep.body(payload.value));
          const status = res.status;
          const body = await res.text().catch(() => '');
          let checkBody = body;

          if (payload.type === 'xss-stored' && status === 201) {
            let createdId: string | null = null;
            try {
              const parsed = JSON.parse(body) as { data?: { id?: string }; id?: string };
              createdId = parsed?.data?.id ?? parsed?.id ?? null;
            } catch {
              createdId = null;
            }

            if (createdId) {
              created.push({ deletePath: ep.getPath(createdId) });
              const getRes = await client.get(ep.getPath(createdId));
              checkBody = await getRes.text().catch(() => '');
            }
          }

          const vulnerable = isVulnerable(payload.type, payload.value, status, checkBody);
          results.push({
            id,
            category: 'input',
            title: `${payload.type} on ${ep.path} (${ep.field})`,
            severity: severityForType(payload.type),
            status: vulnerable ? 'vulnerable' : 'pass',
            description: `Payload type "${payload.type}" submitted to POST ${ep.path} field "${ep.field}".`,
            reproduction: `1. Login using bootstrap probe account\n2. POST ${ep.path} with ${ep.field}: "${payload.value.slice(0, 60)}"\n3. ${payload.type === 'xss-stored' ? 'GET resource and inspect response' : 'Inspect response status and body'}`,
            evidence: {
              request: `POST ${ep.path}\n${JSON.stringify(ep.body(payload.value.slice(0, 80)), null, 2)}`,
              response: `HTTP ${status}\n${checkBody.slice(0, 400)}`,
              expected: 'Payload rejected or escaped',
              actual: vulnerable ? 'Payload found unescaped or server returned 500' : `HTTP ${status} - clean`
            },
            remediation: payload.type.startsWith('xss')
              ? 'Escape all user input in API responses. Use parameterized queries.'
              : payload.type === 'sqli'
                ? 'Use parameterized queries. Never interpolate user input into SQL.'
                : 'Add input length limits and reject null bytes / path traversal sequences.'
          });
        } catch (err: unknown) {
          results.push({
            id,
            category: 'input',
            title: `Input probe error: ${payload.type} on ${ep.path}`,
            severity: 'info',
            status: 'inconclusive',
            description: 'Probe request failed.',
            reproduction: `POST ${ep.path} with ${payload.type} payload`,
            evidence: {
              expected: 'HTTP response',
              actual: err instanceof Error ? err.message : String(err)
            },
            remediation: 'Check connectivity and retry.'
          });
        }
      }
    }
  } finally {
    await client.logout();
  }

  registerCleanupTask({
    label: 'Input probe cleanup (created resources)',
    run: async () => {
      if (created.length === 0) {
        console.log('Input probe cleanup: no deletable resources were created in this run.');
        return;
      }

      const cleanupClient = createHttpClient(config);
      const cleanupLoggedIn = await cleanupClient.login(bootstrapCreds.email, bootstrapCreds.password);
      if (!cleanupLoggedIn) {
        console.log('Input probe cleanup: could not log in for cleanup.');
        await cleanupClient.logout();
        return;
      }

      for (const r of created) {
        await cleanupClient.del(r.deletePath).catch(() => {});
      }
      await cleanupClient.logout();
      console.log(`Input probe cleanup complete. Deleted ${created.length} resource(s).`);
    }
  });
  if (!process.stdin.isTTY && created.length > 0) {
    console.warn(`\n[WARNING] ${created.length} test resources queued for deferred cleanup.`);
  }

  return results;
}
