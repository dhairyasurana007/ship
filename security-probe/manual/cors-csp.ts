import type { Config } from '../config.js';
import type { Finding } from '../types.js';

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
    category: 'cors-csp',
    title,
    severity,
    status: vulnerable ? 'vulnerable' : 'pass',
    description,
    reproduction,
    evidence: { expected, actual },
    remediation
  };
}

export async function checkCorsCsp(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  try {
    const res = await fetch(`${config.target}/health`, { signal: AbortSignal.timeout(config.timeout) });
    const aco = (res.headers.get('access-control-allow-origin') ?? '').trim();
    const acc = (res.headers.get('access-control-allow-credentials') ?? '').trim().toLowerCase();
    results.push(
      finding(
        'CORS-001',
        'Wildcard CORS with credentials enabled',
        aco === '*' && acc === 'true',
        'critical',
        'CORS must not allow credentials with wildcard origin.',
        `GET ${config.target}/health`,
        'No `*` origin when credentials are true',
        `access-control-allow-origin=${aco || '(absent)'}, access-control-allow-credentials=${acc || '(absent)'}`,
        'Restrict origin to explicit trusted domain and review credentials policy.'
      )
    );
  } catch (err: unknown) {
    results.push({
      id: 'CORS-001',
      category: 'cors-csp',
      title: 'CORS header check failed',
      severity: 'info',
      status: 'inconclusive',
      description: 'CORS check request failed.',
      reproduction: `GET ${config.target}/health`,
      evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
      remediation: 'Check reachability and rerun.'
    });
    return results;
  }

  try {
    const res = await fetch(`${config.target}/health`, { signal: AbortSignal.timeout(config.timeout) });
    const csp = res.headers.get('content-security-policy') ?? '';
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [k, ...rest] = d.split(/\s+/);
          return [k, rest.join(' ')];
        })
    ) as Record<string, string>;

    results.push(
      finding(
        'CSP-001',
        "CSP allows unsafe-inline scripts",
        (directives['script-src'] ?? '').includes("'unsafe-inline'"),
        'high',
        'Inline script execution significantly increases XSS risk.',
        `GET ${config.target}/health`,
        "script-src without 'unsafe-inline'",
        directives['script-src'] ? `script-src ${directives['script-src']}` : '(absent)',
        "Use nonces/hashes and remove 'unsafe-inline'."
      )
    );

    results.push(
      finding(
        'CSP-002',
        'CSP missing',
        !csp.trim(),
        'high',
        'Missing CSP leaves browser-side injection defenses weak.',
        `GET ${config.target}/health`,
        'Content-Security-Policy header present',
        csp.trim() ? 'Present' : 'Missing',
        'Set strict Content-Security-Policy header.'
      )
    );
  } catch (err: unknown) {
    results.push({
      id: 'CSP-ERR',
      category: 'cors-csp',
      title: 'CSP check failed',
      severity: 'info',
      status: 'inconclusive',
      description: 'CSP check request failed.',
      reproduction: `GET ${config.target}/health`,
      evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
      remediation: 'Check reachability and rerun.'
    });
  }

  return results;
}
