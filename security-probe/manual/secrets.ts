import type { Config } from '../config.js';
import type { Finding } from '../types.js';

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'DATABASE_URL', re: /DATABASE_URL/i },
  { name: 'SESSION_SECRET', re: /SESSION_SECRET/i },
  { name: 'PRIVATE_KEY', re: /PRIVATE_KEY/i },
  { name: 'AWS key', re: /AKIA[A-Z0-9]{16}/ },
  { name: 'password field', re: /"password"\s*:/i }
];

function scan(body: string): string[] {
  return PATTERNS.filter((p) => p.re.test(body)).map((p) => p.name);
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
    category: 'secrets',
    title,
    severity,
    status: vulnerable ? 'vulnerable' : 'pass',
    description,
    reproduction,
    evidence: { expected, actual },
    remediation
  };
}

export async function checkSecrets(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  try {
    const body = await fetch(`${config.target}/health`, {
      signal: AbortSignal.timeout(config.timeout)
    }).then((r) => r.text());
    const found = scan(body);
    results.push(
      finding(
        'SEC-001',
        '/health endpoint leaks secrets',
        found.length > 0,
        'critical',
        '/health should not expose secrets or sensitive variable names.',
        `GET ${config.target}/health`,
        'No secret patterns in response body',
        found.length > 0 ? `Found: ${found.join(', ')}` : 'Clean',
        'Return minimal health payload only.'
      )
    );
  } catch (err: unknown) {
    results.push({
      id: 'SEC-001',
      category: 'secrets',
      title: 'Secret scan on /health failed',
      severity: 'info',
      status: 'inconclusive',
      description: 'Secret scan request failed.',
      reproduction: `GET ${config.target}/health`,
      evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
      remediation: 'Check reachability and rerun.'
    });
  }

  try {
    const body = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@probe.local', password: 'wrong' }),
      signal: AbortSignal.timeout(config.timeout)
    }).then((r) => r.text());
    const found = scan(body);
    results.push(
      finding(
        'SEC-002',
        'Error response leaks secrets',
        found.length > 0,
        'high',
        'Auth error responses should not leak secret names or values.',
        `POST ${config.target}/api/auth/login with invalid credentials`,
        'Clean generic error body',
        found.length > 0 ? `Found: ${found.join(', ')}` : 'Clean',
        'Sanitize error messages and avoid leaking internals.'
      )
    );
  } catch (err: unknown) {
    results.push({
      id: 'SEC-002',
      category: 'secrets',
      title: 'Secret scan on auth error failed',
      severity: 'info',
      status: 'inconclusive',
      description: 'Auth error secret scan request failed.',
      reproduction: `POST ${config.target}/api/auth/login`,
      evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
      remediation: 'Check reachability and rerun.'
    });
  }

  try {
    const body = await fetch(`${config.target}/health`, {
      signal: AbortSignal.timeout(config.timeout)
    }).then((r) => r.text());
    const exposed = /"NODE_ENV"/.test(body) || /"env"/.test(body);
    results.push(
      finding(
        'SEC-003',
        'Environment details exposed in API response',
        exposed,
        'low',
        'Health response should not expose environment details.',
        `GET ${config.target}/health`,
        'No NODE_ENV/env keys in response',
        exposed ? 'Found NODE_ENV/env pattern' : 'Not found',
        'Remove environment metadata from external responses.'
      )
    );
  } catch (err: unknown) {
    results.push({
      id: 'SEC-003',
      category: 'secrets',
      title: 'Environment exposure check failed',
      severity: 'info',
      status: 'inconclusive',
      description: 'Environment exposure scan request failed.',
      reproduction: `GET ${config.target}/health`,
      evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
      remediation: 'Check reachability and rerun.'
    });
  }

  return results;
}
