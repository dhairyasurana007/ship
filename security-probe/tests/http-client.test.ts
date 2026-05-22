import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { createHttpClient } from '../http-client.js';
import type { Config } from '../config.js';

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch(() => {
        res.statusCode = 500;
        res.end('handler-error');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done, reject) => {
            server.close((err) => (err ? reject(err) : done()));
          })
      });
    });
  });
}

function makeConfig(target: string, override?: Partial<Config>): Config {
  return {
    target,
    output: 'reports',
    verbose: false,
    timeout: 1000,
    repo: null,
    adminEmail: null,
    adminPassword: null,
    ...override
  };
}

test('cookie jar propagates session cookie to subsequent requests', async () => {
  const capturedCookies: string[] = [];
  const server = await startServer((req, res) => {
    if (req.url === '/api/auth/login') {
      res.setHeader('Set-Cookie', 'sessionId=abc123; Path=/; HttpOnly');
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    if (req.url === '/needs-cookie') {
      capturedCookies.push(String(req.headers.cookie ?? ''));
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.end('not-found');
  });

  try {
    const client = createHttpClient(makeConfig(server.url));
    const loggedIn = await client.login('a@example.com', 'pw');
    assert.equal(loggedIn, true);
    await client.get('/needs-cookie');
    assert.equal(capturedCookies.length, 1);
    assert.match(capturedCookies[0] ?? '', /sessionId=abc123/);
  } finally {
    await server.close();
  }
});

test('timeout aborts slow endpoints', async () => {
  const server = await startServer(async (_req, res) => {
    await new Promise((r) => setTimeout(r, 150));
    res.statusCode = 200;
    res.end('slow');
  });

  try {
    const client = createHttpClient(makeConfig(server.url, { timeout: 20 }));
    await assert.rejects(() => client.get('/slow'));
  } finally {
    await server.close();
  }
});

test('verbose mode logs request and response lines to stderr', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/ok') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.end('not-found');
  });

  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    const client = createHttpClient(makeConfig(server.url, { verbose: true }));
    await client.get('/ok');
  } finally {
    process.stderr.write = originalWrite;
    await server.close();
  }

  const combined = writes.join('');
  assert.match(combined, /-> GET \/ok/);
  assert.match(combined, /<- 200 \/ok/);
});

test('helper methods login/logout/getSessionCookieHeader/clearSession', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/api/auth/login') {
      res.setHeader('Set-Cookie', 'sessionId=xyz999; Path=/; HttpOnly');
      res.statusCode = 200;
      res.end('logged-in');
      return;
    }
    if (req.url === '/api/auth/logout') {
      res.statusCode = 200;
      res.end('logged-out');
      return;
    }
    res.statusCode = 404;
    res.end('not-found');
  });

  try {
    const client = createHttpClient(makeConfig(server.url));
    const ok = await client.login('admin@example.com', 'secret');
    assert.equal(ok, true);
    assert.match(client.getSessionCookieHeader(), /sessionId=xyz999/);
    await client.logout();
    assert.equal(client.getSessionCookieHeader(), '');
    client.clearSession();
    assert.equal(client.getSessionCookieHeader(), '');
  } finally {
    await server.close();
  }
});
