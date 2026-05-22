import readline from 'node:readline/promises';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { createHttpClient } from '../http-client.js';

function makeTestCredentials(): { email: string; password: string } {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `probe-test-${nonce}@probe.local`,
    password: `ProbePass!${nonce}`
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function elevateBootstrapUser(target: string, email: string): Promise<void> {
  const token = process.env.PROBE_INTERNAL_ELEVATION_TOKEN;
  if (!token) {
    console.log('Auth probe: PROBE_INTERNAL_ELEVATION_TOKEN not set; skipping internal admin elevation call.');
    return;
  }

  console.log('Auth probe: requesting internal bootstrap admin elevation...');
  const res = await fetch(`${target}/api/internal/probe/elevate-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ email, ttlMinutes: 10 })
  });
  console.log(`Auth probe elevate-admin response: HTTP ${res.status}`);
}

async function verifyAdminAccessWithRetry(
  client: ReturnType<typeof createHttpClient>,
  attempts: number,
  baseDelayMs: number
): Promise<{ ok: boolean; lastStatus: number | null }> {
  let lastStatus: number | null = null;
  for (let i = 1; i <= attempts; i++) {
    const res = await client.get('/api/admin/users');
    lastStatus = res.status;
    if (res.status === 200) {
      return { ok: true, lastStatus };
    }
    const wait = Math.min(baseDelayMs * i, 2000);
    console.log(`Auth probe: admin verification attempt ${i}/${attempts} got HTTP ${res.status}; retrying in ${wait}ms...`);
    await sleep(wait);
  }
  return { ok: false, lastStatus };
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
    category: 'auth',
    title,
    severity,
    status: vulnerable ? 'vulnerable' : 'pass',
    description,
    reproduction,
    evidence: { expected, actual },
    remediation
  };
}

function inconclusiveFinding(
  id: string,
  title: string,
  description: string,
  reproduction: string,
  expected: string,
  actual: string,
  remediation: string
): Finding {
  return {
    id,
    category: 'auth',
    title,
    severity: 'info',
    status: 'inconclusive',
    description,
    reproduction,
    evidence: { expected, actual },
    remediation
  };
}

export async function probeAuth(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];
  const admin = createHttpClient(config);
  const testCreds = makeTestCredentials();
  const bootstrapCreds = makeTestCredentials();

  console.log(`Auth probe test user email: ${testCreds.email}`);
  console.log(`Auth probe test user password: ${testCreds.password}`);
  console.log(`Auth probe bootstrap email: ${bootstrapCreds.email}`);
  console.log(`Auth probe bootstrap password: ${bootstrapCreds.password}`);
  console.log('Auth probe: attempting bootstrap auto-register...');
  try {
    const registerRes = await fetch(`${config.target}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: bootstrapCreds.email,
        password: bootstrapCreds.password
      })
    });
    console.log(`Auth probe bootstrap register response: HTTP ${registerRes.status}`);
    await elevateBootstrapUser(config.target, bootstrapCreds.email);
    console.log('Auth probe: waiting 1500ms before bootstrap login...');
    await sleep(1500);
    const bootstrapClient = createHttpClient(config);
    const bootstrapLoggedIn = await bootstrapClient.login(bootstrapCreds.email, bootstrapCreds.password);
    console.log(`Auth probe bootstrap login ${bootstrapLoggedIn ? 'succeeded' : 'failed'}.`);
    await bootstrapClient.logout().catch(() => {});
  } catch (err) {
    console.log(
      `Auth probe bootstrap auto-register failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log('Auth probe: attempting runtime login...');
  const loggedIn = await admin.login(bootstrapCreds.email, bootstrapCreds.password);
  console.log(`Auth probe: runtime login ${loggedIn ? 'succeeded' : 'failed'}.`);

  if (!loggedIn) {
    return [
      {
        id: 'AUTH-000',
        category: 'auth',
        title: 'Bootstrap login failed',
        severity: 'info',
        status: 'inconclusive',
        description: 'Could not log in with generated bootstrap credentials.',
        reproduction: 'Check /api/auth/register and /api/auth/login availability.',
        evidence: {
          expected: 'HTTP 200 from POST /api/auth/login with generated credentials',
          actual: 'Non-200 response'
        },
        remediation: 'Ensure auth registration/login flow is available for probe bootstrap.'
      }
    ];
  }

  console.log('Auth probe: verifying bootstrap account has admin access...');
  const adminCheck = await verifyAdminAccessWithRetry(admin, 4, 500);
  const adminReady = adminCheck.ok;
  if (!adminReady) {
    console.log(
      `Auth probe: admin verification failed (last status: ${adminCheck.lastStatus ?? 'unknown'}).`
    );
    results.push(
      inconclusiveFinding(
        'AUTH-SETUP',
        'Bootstrap admin setup not confirmed',
        'Bootstrap login succeeded but privileged access could not be verified.',
        'Login bootstrap account, then verify GET /api/admin/users returns 200.',
        'HTTP 200',
        adminCheck.lastStatus == null ? 'No response status' : `HTTP ${adminCheck.lastStatus}`,
        'Ensure bootstrap account has admin role before running admin-dependent checks.'
      )
    );
  } else {
    console.log('Auth probe: bootstrap admin access verified.');
  }

  let testUserId: string | null = null;

  try {
    if (adminReady) {
      const createRes = await admin.post('/api/admin/users', {
        email: testCreds.email,
        password: testCreds.password,
        role: 'member'
      });
      if (createRes.ok) {
        try {
          const raw = await createRes.text();
          if (raw.trim()) {
            const body = JSON.parse(raw) as { data?: { id?: string }; id?: string };
            testUserId = body?.data?.id ?? body?.id ?? null;
          } else {
            testUserId = null;
          }
        } catch {
          testUserId = null;
        }
      }
    }

    {
      const c = createHttpClient(config);
      const res = await c.get('/api/documents');
      results.push(
        finding(
          'AUTH-001',
          'Unauthenticated access to protected route',
          res.status !== 401,
          'high',
          'GET /api/documents without a session cookie should return 401.',
          'Send GET /api/documents with no Cookie header.',
          'HTTP 401',
          `HTTP ${res.status}`,
          'Ensure all non-public routes use authMiddleware.'
        )
      );
    }

    {
      const c = createHttpClient(config);
      const res = await c.get('/api/admin/users');
      results.push(
        finding(
          'AUTH-002',
          'Unauthenticated access to admin route',
          res.status !== 401 && res.status !== 403,
          'high',
          'GET /api/admin/users without auth should return 401 or 403.',
          'Send GET /api/admin/users with no Cookie header.',
          'HTTP 401 or 403',
          `HTTP ${res.status}`,
          'Ensure admin routes use superAdminMiddleware.'
        )
      );
    }

    {
      const raw = await fetch(`${config.target}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: bootstrapCreds.email, password: bootstrapCreds.password })
      });
      const cookieStr = (raw.headers.getSetCookie?.() ?? []).join('; ').toLowerCase();
      const missing: string[] = [];
      if (!cookieStr.includes('httponly')) missing.push('HttpOnly');
      if (!cookieStr.includes('secure')) missing.push('Secure');
      if (!cookieStr.includes('samesite=strict')) missing.push('SameSite=Strict');
      results.push(
        finding(
          'AUTH-003',
          'Session cookie missing security flags',
          missing.length > 0,
          missing.includes('HttpOnly') || missing.includes('Secure') ? 'high' : 'medium',
          'Session cookies must have HttpOnly, Secure, and SameSite=Strict.',
          'POST /api/auth/login - inspect Set-Cookie header.',
          'Cookie flags: HttpOnly; Secure; SameSite=Strict',
          missing.length === 0 ? 'All flags present' : `Missing: ${missing.join(', ')}`,
          'Set all three flags in the session cookie configuration.'
        )
      );
    }

    if (testUserId) {
      const member = createHttpClient(config);
      await member.login(testCreds.email, testCreds.password);
      const res = await member.get('/api/admin/users');
      await member.logout();
      results.push(
        finding(
          'AUTH-004',
          'Privilege escalation: member accessing admin endpoint',
          res.status === 200,
          'critical',
          'A member-role user should receive 403 on GET /api/admin/users.',
          `1. Login as ${testCreds.email} (member role)\n2. GET /api/admin/users`,
          'HTTP 403',
          `HTTP ${res.status}`,
          'Ensure admin routes check role before responding.'
        )
      );
    } else {
      results.push(
        inconclusiveFinding(
          'AUTH-004',
          'Privilege escalation: member accessing admin endpoint',
          'Member-role test user could not be created, so privilege escalation test could not run.',
          'Create throwaway member user, login as member, GET /api/admin/users.',
          'HTTP 403',
          adminReady ? 'Test user creation failed' : 'Bootstrap admin verification failed',
          adminReady
            ? 'Fix admin user creation path for the probe and rerun.'
            : 'Fix bootstrap admin setup and rerun.'
        )
      );
    }

    if (testUserId) {
      const member = createHttpClient(config);
      await member.login(testCreds.email, testCreds.password);
      const res = await member.post('/api/documents', { title: 'probe-csrf', document_type: 'wiki' }, {});
      await member.logout();
      results.push(
        finding(
          'AUTH-005',
          'State-changing POST accepted without CSRF token',
          res.status === 201 || res.status === 200,
          'high',
          'POST /api/documents without x-csrf-token should be rejected.',
          `1. Login as ${testCreds.email}\n2. POST /api/documents with no x-csrf-token header`,
          'HTTP 401 or 403',
          `HTTP ${res.status}`,
          'Ensure csrf-sync middleware applies to all state-changing routes.'
        )
      );
    } else {
      results.push(
        inconclusiveFinding(
          'AUTH-005',
          'State-changing POST accepted without CSRF token',
          'Member-role test user could not be created, so CSRF test could not run.',
          'Create throwaway member user, login as member, POST /api/documents without x-csrf-token.',
          'HTTP 401 or 403',
          adminReady ? 'Test user creation failed' : 'Bootstrap admin verification failed',
          adminReady
            ? 'Fix admin user creation path for the probe and rerun.'
            : 'Fix bootstrap admin setup and rerun.'
        )
      );
    }

    {
      const res = await fetch(`${config.target}/api/documents`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-probe-token-00000',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: 'probe-invalid-bearer', document_type: 'wiki' })
      });
      results.push(
        finding(
          'AUTH-006',
          'Invalid Bearer token correctly rejected',
          res.status !== 401,
          'info',
          'An invalid Bearer token should return 401.',
          'POST /api/documents with Authorization: Bearer invalid-probe-token-00000 and no CSRF token',
          'HTTP 401',
          `HTTP ${res.status}`,
          'No action required if 401.'
        )
      );
    }

    {
      const c = createHttpClient(config);
      let firstLimit = -1;
      for (let i = 1; i <= 8; i++) {
        const res = await c.post('/api/auth/login', { email: 'nobody@probe.local', password: 'wrong' });
        if (res.status === 429 && firstLimit === -1) {
          firstLimit = i;
          break;
        }
      }
      results.push(
        finding(
          'AUTH-007',
          'Login endpoint allows brute force',
          firstLimit === -1 || firstLimit > 7,
          'high',
          'Login should rate-limit after 5 failed attempts within 15 minutes.',
          'Send 8 rapid failed POST /api/auth/login requests.',
          'HTTP 429 by attempt 7',
          firstLimit === -1 ? 'No 429 after 8 attempts' : `429 at attempt ${firstLimit}`,
          'Ensure express-rate-limit applies to POST /api/auth/login.'
        )
      );
    }

    {
      const c = createHttpClient(config);
      await c.login(bootstrapCreds.email, bootstrapCreds.password);
      const oldCookie = c.getSessionCookieHeader();
      await c.logout();
      const res = await fetch(`${config.target}/api/documents`, { headers: { Cookie: oldCookie } });
      results.push(
        finding(
          'AUTH-008',
          'Session cookie still valid after logout',
          res.status === 200,
          'critical',
          'A cookie replayed after logout should return 401.',
          '1. Login\n2. Logout\n3. Replay old Cookie header on GET /api/documents',
          'HTTP 401',
          `HTTP ${res.status}`,
          'Destroy the session server-side on logout.'
        )
      );
    }

    {
      const c1 = createHttpClient(config);
      const c2 = createHttpClient(config);
      await c1.login(bootstrapCreds.email, bootstrapCreds.password);
      await c2.login(bootstrapCreds.email, bootstrapCreds.password);
      const t1 = c1.getSessionCookieHeader();
      const t2 = c2.getSessionCookieHeader();
      await c1.logout();
      await c2.logout();
      let shared = false;
      for (let i = 0; i <= t1.length - 4; i++) {
        if (t2.includes(t1.slice(i, i + 4))) {
          shared = true;
          break;
        }
      }
      results.push(
        finding(
          'AUTH-009',
          'Session tokens appear predictable',
          shared,
          'medium',
          'Two consecutive tokens should share no 4+ character substring.',
          '1. Login twice\n2. Compare session cookie values',
          'No shared 4+ char substrings',
          shared ? 'Tokens share a substring' : 'Tokens appear random',
          'Use a cryptographically random session secret of at least 32 bytes.'
        )
      );
    }
  } finally {
    if (testUserId) {
      let shouldDelete = true;
      if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await rl.question('\nAuth probe created test user data. Delete it now? [Y/n] ');
          shouldDelete = answer.trim().toLowerCase() !== 'n';
        } finally {
          rl.close();
        }
      }
      if (shouldDelete) {
        await admin.del(`/api/admin/users/${testUserId}`).catch(() => {});
      } else {
        console.log(`Auth probe cleanup skipped. Manual delete path: /api/admin/users/${testUserId}`);
      }
    }
    await admin.logout();
  }

  return results;
}
