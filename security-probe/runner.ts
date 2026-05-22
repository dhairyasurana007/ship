import type { Config } from './config.js';
import type { Category, Finding, Report, Severity } from './types.js';
import { probeDeps } from './probes/deps.js';
import { probeAuth } from './probes/auth.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth',
  'websocket',
  'input',
  'dependency',
  'cors-csp',
  'secrets',
  'rate-limiting',
  'error-verbosity'
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])
  ) as Record<Severity, number>;

  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, findings.filter((f) => f.category === c).length])
  ) as Partial<Record<Category, number>>;

  return {
    total: findings.length,
    vulnerable: findings.filter((f) => f.status === 'vulnerable').length,
    passed: findings.filter((f) => f.status === 'pass').length,
    inconclusive: findings.filter((f) => f.status === 'inconclusive').length,
    bySeverity,
    byCategory
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [...(await probeDeps(config))];
  findings.push(...(await probeAuth(config)));

  return {
    generated: new Date().toISOString(),
    target: config.target,
    summary: buildSummary(findings),
    findings
  };
}
