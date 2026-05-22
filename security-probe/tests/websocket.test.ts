import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __setServerAliveForTests,
  __setWsConnectForTests,
  probeWebSocket
} from '../probes/websocket.js';
import type { Config } from '../config.js';

class FakeWs {
  closed = false;
  handlers: Record<string, Array<() => void>> = {};
  send(_data: unknown): void {
    // no-op
  }
  terminate(): void {
    this.closed = true;
    for (const fn of this.handlers.close ?? []) fn();
  }
  on(event: string, fn: () => void): void {
    this.handlers[event] = this.handlers[event] ?? [];
    this.handlers[event]?.push(fn);
  }
}

function cfg(): Config {
  return {
    target: 'https://example.test',
    output: 'reports',
    verbose: false,
    timeout: 1000,
    repo: null,
    adminEmail: 'admin@example.gov',
    adminPassword: 'secret'
  };
}

function response(status: number, body: unknown = {}, headers?: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

test('probeWebSocket emits WS-001..WS-008 with mocked connect behavior', async () => {
  const originalFetch = globalThis.fetch;
  const connectCalls: string[] = [];
  const healthCalls: string[] = [];

  __setWsConnectForTests(async (url) => {
    connectCalls.push(url);
    const ws = new FakeWs() as unknown as import('ws').default;
    if (url.includes('nonexistent-probe-00000')) return { ws, httpStatus: 404 };
    if (url.includes('private')) return { ws, httpStatus: 403 };
    return { ws, httpStatus: 401 };
  });
  __setServerAliveForTests(async (target) => {
    healthCalls.push(target);
    return true;
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && path === '/api/auth/login') {
      const h = new Headers();
      h.append('set-cookie', 'sid=admin; Path=/; HttpOnly; Secure; SameSite=Strict');
      return response(200, { ok: true }, h);
    }
    if (method === 'POST' && path === '/api/documents') {
      if (String(init?.body ?? '').includes('probe-ws-private')) return response(201, { data: { id: 'private' } });
      return response(201, { data: { id: 'doc1' } });
    }
    if (method === 'POST' && path === '/api/admin/users') return response(201, { data: { id: 'user1' } });
    if (method === 'DELETE' && (path.includes('/api/documents/') || path.includes('/api/admin/users/'))) {
      return response(204, {});
    }
    if (method === 'POST' && path === '/api/auth/logout') return response(200, {});
    if (method === 'GET' && path === '/health') return response(200, { ok: true });
    return response(404, {});
  }) as typeof fetch;

  try {
    const findings = await probeWebSocket(cfg());
    for (let i = 1; i <= 8; i++) {
      const id = `WS-${String(i).padStart(3, '0')}`;
      assert.ok(findings.some((f) => f.id === id), `missing ${id}`);
    }
    assert.ok(healthCalls.length >= 3, 'expected health checks for fuzz/crash tests');
    assert.ok(connectCalls.length >= 8, 'expected connect calls for WS tests');
  } finally {
    __setWsConnectForTests(null);
    __setServerAliveForTests(null);
    globalThis.fetch = originalFetch;
  }
});

