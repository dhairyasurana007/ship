import assert from 'node:assert/strict';
import test from 'node:test';
import { probeInput } from '../probes/input.js';
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

function response(status: number, body: unknown = {}, headers?: Headers): Response {
  const h = headers ?? new Headers();
  return new Response(JSON.stringify(body), { status, headers: h });
}

test('probeInput returns INP-000 when bootstrap login fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && path === '/api/auth/register') return response(201, {});
    if (method === 'POST' && path === '/api/auth/login') return response(401, {});
    return response(404, {});
  }) as typeof fetch;

  try {
    const findings = await probeInput(cfg());
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.id, 'INP-000');
    assert.equal(findings[0]?.status, 'inconclusive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeInput emits 30 deterministic findings across payload matrix', async () => {
  const originalFetch = globalThis.fetch;
  let createdCounter = 0;
  const createdValues = new Map<string, string>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && path === '/api/auth/register') return response(201, {});
    if (method === 'POST' && path === '/api/auth/login') {
      const h = new Headers();
      h.append('set-cookie', 'sid=input-admin; HttpOnly; Secure; SameSite=Strict; Path=/');
      return response(200, { ok: true }, h);
    }
    if (method === 'POST' && (path === '/api/documents' || path === '/api/issues' || path === '/api/projects')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const value = String(body.title ?? body.name ?? '');
      createdCounter += 1;
      const id = `created-${createdCounter}`;
      createdValues.set(id, value);
      return response(201, { data: { id } });
    }
    if (method === 'GET' && path.startsWith('/api/documents/')) {
      const id = path.split('/').pop() ?? '';
      const value = createdValues.get(id) ?? '';
      return response(200, { data: { title: value } });
    }
    if (method === 'DELETE' && path.startsWith('/api/')) return response(204, {});
    if (method === 'POST' && path === '/api/auth/logout') return response(200, {});
    return response(404, {});
  }) as typeof fetch;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const findings = await probeInput(cfg());
    assert.equal(findings.length, 30);
    const ids = new Set(findings.map((f) => f.id));
    for (let endpoint = 1; endpoint <= 3; endpoint++) {
      for (let payload = 1; payload <= 10; payload++) {
        const id = `INP-${endpoint}-${String(payload).padStart(2, '0')}`;
        assert.ok(ids.has(id), `missing ${id}`);
      }
    }
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});
