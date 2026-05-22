import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRateLimit } from '../manual/rate-limit.js';
import { checkErrorVerbosity } from '../manual/error-verbosity.js';
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

function response(status: number, body = '{}'): Response {
  return new Response(body, { status });
}

test('checkRateLimit returns RL-001..RL-003 with expected statuses', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  let docsCalls = 0;
  let loginCalls = 0;

  globalThis.setTimeout = (((handler: TimerHandler) => {
    if (typeof handler === 'function') {
      handler();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;

    if (path === '/api/documents') {
      docsCalls += 1;
      return docsCalls >= 7 ? response(429) : response(401);
    }

    if (path === '/api/auth/login') {
      loginCalls += 1;
      return loginCalls >= 4 ? response(429) : response(401);
    }

    return response(404);
  }) as typeof fetch;

  try {
    const findings = await checkRateLimit(cfg());
    const ids = new Set(findings.map((f) => f.id));
    assert.ok(ids.has('RL-001'));
    assert.ok(ids.has('RL-002'));
    assert.ok(ids.has('RL-003'));

    assert.equal(findings.find((f) => f.id === 'RL-001')?.status, 'pass');
    assert.equal(findings.find((f) => f.id === 'RL-002')?.status, 'pass');
    assert.equal(findings.find((f) => f.id === 'RL-003')?.status, 'inconclusive');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('checkErrorVerbosity returns ERR-001..ERR-003 and leak detection', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;

    if (path === '/api/auth/login') {
      return response(400, 'Bad JSON at Module.parseBody /app/server/auth.ts');
    }

    if (path === '/api/nonexistent-route-probe-12345') {
      return response(404, '{"error":"not found"}');
    }

    if (path === '/api/documents') {
      return response(500, 'Unhandled error at Object.createDocument');
    }

    return response(404);
  }) as typeof fetch;

  try {
    const findings = await checkErrorVerbosity(cfg());
    const ids = new Set(findings.map((f) => f.id));
    assert.ok(ids.has('ERR-001'));
    assert.ok(ids.has('ERR-002'));
    assert.ok(ids.has('ERR-003'));

    assert.equal(findings.find((f) => f.id === 'ERR-001')?.status, 'vulnerable');
    assert.equal(findings.find((f) => f.id === 'ERR-002')?.status, 'pass');
    assert.equal(findings.find((f) => f.id === 'ERR-003')?.status, 'vulnerable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
