import type { Config } from '../config.js';
import type { Finding } from '../types.js';

const LEAK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'stack frame', re: /at Object\.|at Module\.|at async / },
  { name: 'file path', re: /\/app\/|\/home\/|C:\\\\/ },
  { name: 'SQL keyword', re: /\bSELECT\b|\bFROM\b|\bWHERE\b/ }
];

function detectLeak(body: string): string[] {
  return LEAK_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.name);
}

export async function checkErrorVerbosity(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  try {
    const res = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
      signal: AbortSignal.timeout(config.timeout)
    });
    const body = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-001',
      category: 'error-verbosity',
      title: 'Malformed JSON triggers verbose error',
      severity: 'medium',
      status: leaked.length > 0 ? 'vulnerable' : 'pass',
      description: 'A malformed JSON body should produce a clean 400, not a stack trace.',
      reproduction: `POST ${config.target}/api/auth/login\nContent-Type: application/json\n\nthis is not json`,
      evidence: {
        request: 'POST /api/auth/login\nContent-Type: application/json\n\nthis is not json',
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'Clean 400 with no internal details',
        actual: leaked.length > 0 ? `Leaked: ${leaked.join(', ')}` : 'No leakage'
      },
      remediation: 'Add a global Express error handler that sanitizes all 4xx/5xx responses.'
    });
  } catch (err: unknown) {
    results.push({
      id: 'ERR-001',
      category: 'error-verbosity',
      title: 'ERR-001 error',
      severity: 'info',
      status: 'inconclusive',
      description: '',
      reproduction: '',
      evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) },
      remediation: ''
    });
  }

  try {
    const res = await fetch(`${config.target}/api/nonexistent-route-probe-12345`, {
      signal: AbortSignal.timeout(config.timeout)
    });
    const body = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-002',
      category: 'error-verbosity',
      title: '404 response leaks internal paths',
      severity: 'low',
      status: leaked.length > 0 ? 'vulnerable' : 'pass',
      description: 'A 404 for an unknown route should not reveal file paths or stack traces.',
      reproduction: `GET ${config.target}/api/nonexistent-route-probe-12345`,
      evidence: {
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'Clean 404',
        actual: leaked.length > 0 ? `Leaked: ${leaked.join(', ')}` : 'No leakage'
      },
      remediation: 'Ensure the Express 404 handler returns a generic message.'
    });
  } catch (err: unknown) {
    results.push({
      id: 'ERR-002',
      category: 'error-verbosity',
      title: 'ERR-002 error',
      severity: 'info',
      status: 'inconclusive',
      description: '',
      reproduction: '',
      evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) },
      remediation: ''
    });
  }

  try {
    const res = await fetch(`${config.target}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(config.timeout)
    });
    const body = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-003',
      category: 'error-verbosity',
      title: 'Unauthenticated empty POST returns 500 or leaks internals',
      severity: 'medium',
      status: res.status >= 500 || leaked.length > 0 ? 'vulnerable' : 'pass',
      description: 'POST /api/documents with no auth and empty body should return 401, not 500.',
      reproduction: `POST ${config.target}/api/documents\nContent-Type: application/json\n\n{}`,
      evidence: {
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'HTTP 401, no stack trace',
        actual:
          res.status >= 500
            ? `HTTP ${res.status}`
            : leaked.length > 0
              ? `Leaked: ${leaked.join(', ')}`
              : `HTTP ${res.status} - clean`
      },
      remediation: 'Ensure authMiddleware runs before body validation.'
    });
  } catch (err: unknown) {
    results.push({
      id: 'ERR-003',
      category: 'error-verbosity',
      title: 'ERR-003 error',
      severity: 'info',
      status: 'inconclusive',
      description: '',
      reproduction: '',
      evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) },
      remediation: ''
    });
  }

  return results;
}
