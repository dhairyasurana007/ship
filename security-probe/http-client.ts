import { CookieJar } from 'tough-cookie';
import type { Config } from './config.js';
import { getApiTarget } from './targets.js';

export interface HttpClient {
  get(path: string, extraHeaders?: Record<string, string>): Promise<Response>;
  post(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<Response>;
  patch(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<Response>;
  del(path: string, extraHeaders?: Record<string, string>): Promise<Response>;
  login(email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  clearSession(): void;
  getSessionCookieHeader(): string;
}

export function createHttpClient(config: Config): HttpClient {
  const { timeout, verbose } = config;
  const target = getApiTarget(config);
  const jar = new CookieJar();

  async function request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const url = `${target}${path}`;
    const cookies = await jar.getCookies(target);
    const cookieHeader = cookies.map((c) => `${c.key}=${c.value}`).join('; ');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...extraHeaders
    };

    if (verbose) {
      process.stderr.write(`-> ${method} ${path}\n`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const setCookieViaMethod = response.headers.getSetCookie?.() ?? [];
    const setCookieViaSingle = response.headers.get('set-cookie');
    const setCookies = setCookieViaSingle
      ? [...setCookieViaMethod, setCookieViaSingle]
      : setCookieViaMethod;

    for (const cookie of setCookies) {
      await jar.setCookie(cookie, target).catch(() => {});
    }

    if (verbose) {
      process.stderr.write(`<- ${response.status} ${path}\n`);
    }

    return response;
  }

  return {
    get: (path, extraHeaders) => request('GET', path, undefined, extraHeaders),
    post: (path, body, extraHeaders) => request('POST', path, body, extraHeaders),
    patch: (path, body, extraHeaders) => request('PATCH', path, body, extraHeaders),
    del: (path, extraHeaders) => request('DELETE', path, undefined, extraHeaders),
    async login(email: string, password: string): Promise<boolean> {
      const res = await request('POST', '/api/auth/login', { email, password });
      return res.ok;
    },
    async logout(): Promise<void> {
      await request('POST', '/api/auth/logout').catch(() => {});
      await jar.removeAllCookies();
    },
    clearSession(): void {
      jar.removeAllCookiesSync();
    },
    getSessionCookieHeader(): string {
      return jar.getCookiesSync(target).map((c) => `${c.key}=${c.value}`).join('; ');
    }
  };
}
