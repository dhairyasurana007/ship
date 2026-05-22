import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCorsCsp } from '../manual/cors-csp.js';
import { checkSecrets } from '../manual/secrets.js';
import type { Config } from '../config.js';

function cfg(): Config {
  return {
    target: 'https://example.test',
    output: 'reports',
    verbose: false,
    timeout: 1000,
    repo: null,
    adminEmail: null,
    adminPassword: null
  };
}

function response(status: number, body: string, headers?: Headers): Response {
  return new Response(body, { status, headers });
}

test('checkCorsCsp emits CORS/CSP findings from headers', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    if (path === '/health') {
      const h = new Headers();
      h.set('access-control-allow-origin', '*');
      h.set('access-control-allow-credentials', 'true');
      h.set('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'");
      return response(200, '{"status":"ok"}', h);
    }
    return response(404, '{}');
  }) as typeof fetch;

  try {
    const findings = await checkCorsCsp(cfg());
    assert.ok(findings.some((f) => f.id === 'CORS-001'));
    assert.ok(findings.some((f) => f.id === 'CSP-001'));
    assert.ok(findings.some((f) => f.id === 'CSP-002'));
    const cors = findings.find((f) => f.id === 'CORS-001');
    assert.equal(cors?.status, 'vulnerable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkSecrets emits SEC-001..SEC-003', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path === '/health') {
      return response(200, '{"status":"ok","NODE_ENV":"production","DATABASE_URL":"postgres://x"}');
    }
    if (method === 'POST' && path === '/api/auth/login') {
      return response(401, '{"error":"bad creds","hint":"SESSION_SECRET missing"}');
    }
    return response(404, '{}');
  }) as typeof fetch;

  try {
    const findings = await checkSecrets(cfg());
    const ids = new Set(findings.map((f) => f.id));
    assert.ok(ids.has('SEC-001'));
    assert.ok(ids.has('SEC-002'));
    assert.ok(ids.has('SEC-003'));
    assert.equal(findings.find((f) => f.id === 'SEC-001')?.status, 'vulnerable');
    assert.equal(findings.find((f) => f.id === 'SEC-002')?.status, 'vulnerable');
    assert.equal(findings.find((f) => f.id === 'SEC-003')?.status, 'vulnerable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
