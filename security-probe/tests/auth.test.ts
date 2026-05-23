import assert from 'node:assert/strict';
import test from 'node:test';
import { probeAuth } from '../probes/auth.js';
import type { Config } from '../config.js';

function cfg(target: string, override?: Partial<Config>): Config {
  return {
    target,
    output: 'reports',
    verbose: false,
    timeout: 1000,
    repo: null,
    adminEmail: 'admin@example.gov',
    adminPassword: 'secret',
    ...override
  };
}

function response(status: number, body: unknown = {}, headers?: Headers): Response {
  const h = headers ?? new Headers();
  return new Response(JSON.stringify(body), { status, headers: h });
}

test('probeAuth works without admin credentials when bootstrap login works', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && path === '/api/auth/register') return response(201, {});
    if (method === 'POST' && path === '/api/auth/login') {
      const h = new Headers();
      h.append('set-cookie', 'sid=boot-abc; HttpOnly; Secure; SameSite=Strict; Path=/');
      return response(200, { ok: true }, h);
    }
    if (method === 'POST' && path === '/api/admin/users') return response(500, { error: 'create failed' });
    if (method === 'POST' && path === '/api/auth/logout') return response(200, {});
    if (method === 'GET' && path === '/api/documents') return response(401, {});
    if (method === 'GET' && path === '/api/admin/users') return response(401, {});
    if (method === 'POST' && path === '/api/documents') return response(401, {});
    return response(404, {});
  }) as typeof fetch;

  try {
    const findings = await probeAuth(cfg('https://example.test', { adminEmail: null, adminPassword: null }));
    assert.equal(findings.length, 10);
    assert.ok(findings.some((f) => f.id === 'AUTH-SETUP'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeAuth emits AUTH-001..AUTH-009 and tears down created user', async () => {
  const calls: Array<{ method: string; path: string; headers?: HeadersInit }> = [];
  let authLoginAttempts = 0;
  let probeLoginCount = 0;
  const users = [{ id: 'user-1', email: 'probe-test-a@probe.local' }];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path, headers: init?.headers });

    if (method === 'POST' && path === '/api/auth/login') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.email === 'admin@example.gov' && body.password === 'secret') {
        const h = new Headers();
        h.append('set-cookie', 'sid=admin-abc; HttpOnly; Secure; SameSite=Strict; Path=/');
        return response(200, { ok: true }, h);
      }
      if (body.email && String(body.email).startsWith('probe-test-')) {
        probeLoginCount += 1;
        const h = new Headers();
        if (probeLoginCount <= 2) {
          h.append('set-cookie', 'sid=admin-abc; HttpOnly; Secure; SameSite=Strict; Path=/');
        } else {
          h.append('set-cookie', 'sid=member-xyz; HttpOnly; Secure; SameSite=Strict; Path=/');
        }
        return response(200, { ok: true }, h);
      }
      authLoginAttempts += 1;
      if (authLoginAttempts >= 6) return response(429, { error: 'rate limited' });
      return response(401, { error: 'bad creds' });
    }

    if (method === 'POST' && path === '/api/admin/users') {
      return response(201, { data: { id: 'user-1' } });
    }
    if (method === 'DELETE' && path === '/api/admin/users/user-1') {
      users.splice(0, users.length);
      return response(204, {});
    }

    if (method === 'GET' && path === '/api/documents') {
      const auth = new Headers(init?.headers).get('authorization');
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      if (auth?.startsWith('Bearer invalid-probe-token-00000')) return response(401, {});
      if (cookie.includes('sid=admin-abc') || cookie.includes('sid=member-xyz')) return response(200, {});
      if (cookie.includes('sid=stale-cookie')) return response(401, {});
      return response(401, {});
    }

    if (method === 'GET' && path === '/api/admin/users') {
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      if (cookie.includes('sid=member-xyz')) return response(403, {});
      if (cookie.includes('sid=admin-abc')) return response(200, { data: users });
      return response(401, {});
    }

    if (method === 'POST' && path === '/api/documents') {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth?.startsWith('Bearer invalid-probe-token-00000')) return response(401, {});
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      if (cookie.includes('sid=member-xyz')) return response(403, {});
      return response(401, {});
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      return response(200, {});
    }

    return response(404, { error: 'not mocked' });
  }) as typeof fetch;

  try {
    const findings = await probeAuth(cfg('https://example.test'));
    assert.equal(findings.length, 9);
    assert.ok(!findings.some((f) => f.id === 'AUTH-SETUP'));
    for (let i = 1; i <= 9; i++) {
      const id = `AUTH-${String(i).padStart(3, '0')}`;
      assert.ok(findings.some((f) => f.id === id), `missing finding ${id}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeAuth still emits AUTH-004 and AUTH-005 as inconclusive when user creation fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && path === '/api/auth/login') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.email && String(body.email).startsWith('probe-test-')) {
        const h = new Headers();
        h.append('set-cookie', 'sid=admin-abc; HttpOnly; Secure; SameSite=Strict; Path=/');
        return response(200, { ok: true }, h);
      }
      if (body.email === 'nobody@probe.local') return response(429, {});
      return response(401, {});
    }

    if (method === 'POST' && path === '/api/admin/users') return response(500, { error: 'create failed' });
    if (method === 'POST' && path === '/api/auth/logout') return response(200, {});
    if (method === 'GET' && path === '/api/documents') return response(401, {});
    if (method === 'GET' && path === '/api/admin/users') return response(401, {});
    if (method === 'POST' && path === '/api/documents') return response(401, {});
    return response(404, {});
  }) as typeof fetch;

  try {
    const findings = await probeAuth(cfg('https://example.test'));
    assert.equal(findings.length, 10);
    assert.ok(findings.some((f) => f.id === 'AUTH-SETUP'));
    const f4 = findings.find((f) => f.id === 'AUTH-004');
    const f5 = findings.find((f) => f.id === 'AUTH-005');
    assert.equal(f4?.status, 'inconclusive');
    assert.equal(f5?.status, 'inconclusive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
