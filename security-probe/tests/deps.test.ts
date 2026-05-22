import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __setExecSyncForTests,
  filterHighCritical,
  parseAuditJson,
  probeDeps
} from '../probes/deps.js';
import { buildSummary } from '../runner.js';

test('parseAuditJson returns advisories array', () => {
  const input = JSON.stringify({
    advisories: {
      a1: { id: 1, module_name: 'x', severity: 'low' },
      a2: { id: 2, module_name: 'y', severity: 'critical' }
    }
  });

  const advisories = parseAuditJson(input);
  assert.equal(advisories.length, 2);
});

test('filterHighCritical keeps only high and critical', () => {
  const advisories = [
    { id: 1, severity: 'info' },
    { id: 2, severity: 'low' },
    { id: 3, severity: 'moderate' },
    { id: 4, severity: 'high' },
    { id: 5, severity: 'critical' }
  ];

  const filtered = filterHighCritical(advisories);
  assert.deepEqual(
    filtered.map((x) => x.id),
    [4, 5]
  );
});

test('empty advisories produces empty parsed output', () => {
  const input = JSON.stringify({ advisories: {} });
  const advisories = parseAuditJson(input);
  assert.deepEqual(advisories, []);
});

test('probeDeps handles non-zero pnpm audit exit and parses stdout', async (t) => {
  __setExecSyncForTests(((command: string) => {
    if (command === 'pnpm audit --json') {
      const err = new Error('audit exit 1') as Error & { stdout?: string };
      err.stdout = JSON.stringify({
        advisories: {
          a1: {
            id: 101,
            title: 'Critical test advisory',
            module_name: 'left-pad',
            severity: 'critical',
            cves: ['CVE-2099-0001'],
            vulnerable_versions: '<1.0.0',
            patched_versions: '>=1.0.0',
            overview: 'test',
            findings: [{ version: '0.0.9' }]
          }
        }
      });
      throw err;
    }
    throw new Error('no matches');
  }) as unknown as typeof import('node:child_process').execSync);
  t.after(() => __setExecSyncForTests(null));

  const findings = await probeDeps({
    target: 'https://example.test',
    output: '.',
    verbose: false,
    timeout: 10000,
    repo: process.cwd(),
    adminEmail: null,
    adminPassword: null
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.id, 'DEP-001');
  assert.equal(findings[0]?.status, 'vulnerable');
  assert.equal(findings[0]?.severity, 'critical');
});

test('probeDeps returns DEP-000 pass when no high/critical advisories', async (t) => {
  __setExecSyncForTests(((command: string) => {
    if (command === 'pnpm audit --json') {
      return JSON.stringify({
        advisories: {
          a1: { id: 1, module_name: 'x', severity: 'low' }
        }
      });
    }
    throw new Error('no matches');
  }) as unknown as typeof import('node:child_process').execSync);
  t.after(() => __setExecSyncForTests(null));

  const findings = await probeDeps({
    target: 'https://example.test',
    output: '.',
    verbose: false,
    timeout: 10000,
    repo: process.cwd(),
    adminEmail: null,
    adminPassword: null
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.id, 'DEP-000');
  assert.equal(findings[0]?.status, 'pass');
  assert.equal(findings[0]?.category, 'dependency');
});

test('buildSummary includes dependency category counts', () => {
  const summary = buildSummary([
    {
      id: 'DEP-000',
      category: 'dependency',
      title: 'No high or critical CVEs found',
      severity: 'info',
      status: 'pass',
      description: 'ok',
      reproduction: 'ok',
      evidence: { expected: 'x', actual: 'y' },
      remediation: 'none'
    }
  ]);

  assert.equal(summary.total, 1);
  assert.equal(summary.passed, 1);
  assert.equal(summary.byCategory.dependency, 1);
});
