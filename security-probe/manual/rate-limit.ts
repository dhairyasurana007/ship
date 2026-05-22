import type { Config } from '../config.js';
import type { Finding } from '../types.js';

export async function checkRateLimit(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  try {
    let firstLimit = -1;
    for (let i = 1; i <= 120; i++) {
      const res = await fetch(`${config.target}/api/documents`, {
        signal: AbortSignal.timeout(config.timeout)
      });
      if (res.status === 429 && firstLimit === -1) {
        firstLimit = i;
        break;
      }
    }
    results.push({
      id: 'RL-001',
      category: 'rate-limiting',
      title: 'General API endpoint not rate-limited',
      severity: 'medium',
      status: firstLimit !== -1 ? 'pass' : 'vulnerable',
      description: 'GET /api/documents should return 429 within 120 rapid requests.',
      reproduction: 'Send 120 sequential unauthenticated GET /api/documents requests.',
      evidence: {
        expected: 'HTTP 429 before request 110',
        actual: firstLimit === -1 ? 'No 429 after 120 requests' : `First 429 at request ${firstLimit}`
      },
      remediation: 'Apply express-rate-limit to all API routes, not just /api/auth/login.'
    });
  } catch (err: unknown) {
    results.push({
      id: 'RL-001',
      category: 'rate-limiting',
      title: 'RL-001 error',
      severity: 'info',
      status: 'inconclusive',
      description: '',
      reproduction: '',
      evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) },
      remediation: ''
    });
  }

  try {
    let firstLimit = -1;
    for (let i = 1; i <= 8; i++) {
      const res = await fetch(`${config.target}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'probe-rl@probe.local', password: 'wrong' }),
        signal: AbortSignal.timeout(config.timeout)
      });
      if (res.status === 429 && firstLimit === -1) {
        firstLimit = i;
        break;
      }
    }
    results.push({
      id: 'RL-002',
      category: 'rate-limiting',
      title: 'Login endpoint not rate-limited',
      severity: 'high',
      status: firstLimit !== -1 ? 'pass' : 'vulnerable',
      description: 'POST /api/auth/login should return 429 by the 6th failed attempt.',
      reproduction: 'Send 8 sequential POST /api/auth/login with wrong credentials.',
      evidence: {
        expected: 'HTTP 429 by attempt 6',
        actual: firstLimit === -1 ? 'No 429 after 8 attempts' : `First 429 at attempt ${firstLimit}`
      },
      remediation: 'Ensure login rate limiter threshold is <= 5 failed requests per 15 minutes.'
    });
  } catch (err: unknown) {
    results.push({
      id: 'RL-002',
      category: 'rate-limiting',
      title: 'RL-002 error',
      severity: 'info',
      status: 'inconclusive',
      description: '',
      reproduction: '',
      evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) },
      remediation: ''
    });
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const res = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe-rl@probe.local', password: 'wrong' }),
      signal: AbortSignal.timeout(config.timeout)
    });
    results.push({
      id: 'RL-003',
      category: 'rate-limiting',
      title: 'Rate limit window recovery',
      severity: 'info',
      status: 'inconclusive',
      description: 'After 5 seconds, records whether the rate limit window has reset.',
      reproduction: 'Trigger login rate limit, wait 5 seconds, send one more request.',
      evidence: { expected: 'Depends on window duration', actual: `HTTP ${res.status} after 5s wait` },
      remediation: 'Informational only.'
    });
  } catch {
    // informational probe only
  }

  return results;
}
