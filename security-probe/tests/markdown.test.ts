import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeMarkdown } from '../reporter/markdown.js';
import type { Report } from '../types.js';

function fixtureReport(): Report {
  return {
    generated: '2026-05-21T14:30:00.000Z',
    target: 'https://example.test',
    summary: {
      total: 3,
      vulnerable: 2,
      passed: 1,
      inconclusive: 0,
      bySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 1 },
      byCategory: { dependency: 3 }
    },
    findings: [
      {
        id: 'DEP-001',
        category: 'dependency',
        title: 'High vuln',
        severity: 'high',
        status: 'vulnerable',
        description: 'desc',
        reproduction: 'step1\nstep2',
        evidence: { expected: 'safe', actual: 'unsafe' },
        remediation: 'upgrade',
        cve: 'CVE-1',
        affectedFeature: 'Frontend'
      },
      {
        id: 'DEP-002',
        category: 'dependency',
        title: 'Critical vuln',
        severity: 'critical',
        status: 'vulnerable',
        description: 'desc',
        reproduction: 'step1',
        evidence: { expected: 'safe', actual: 'unsafe' },
        remediation: 'upgrade',
        cve: 'CVE-2',
        affectedFeature: 'API'
      },
      {
        id: 'DEP-000',
        category: 'dependency',
        title: 'No high or critical CVEs found',
        severity: 'info',
        status: 'pass',
        description: 'desc',
        reproduction: 'step1',
        evidence: { expected: 'safe', actual: 'safe' },
        remediation: 'none'
      }
    ]
  };
}

test('markdown reporter includes summary table and Not yet tested rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-md-'));
  const file = await writeMarkdown(fixtureReport(), dir);
  const content = await readFile(file, 'utf8');

  assert.match(content, /## Summary/);
  assert.match(content, /\| Auth\/session vulnerabilities \| Not yet tested \|/);
  assert.match(content, /\| WebSocket validation failures \| Not yet tested \|/);
  assert.match(content, /\| High\/Critical CVEs in dependencies \| 2 - CVE-2, CVE-1 \|/);
});

test('markdown reporter snapshot output from fixed fixture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-md-snapshot-'));
  const file = await writeMarkdown(fixtureReport(), dir);
  const content = await readFile(file, 'utf8');

  const expected = `# Shipshape Security Audit Report

Generated: 2026-05-21T14:30:00.000Z
Target: https://example.test

## Summary

| Metric | Result |
|--------|--------|
| Security probe tool | Runnable |
| Auth/session vulnerabilities | Not yet tested |
| WebSocket validation failures | Not yet tested |
| Input sanitization failures | Not yet tested |
| High/Critical CVEs in dependencies | 2 - CVE-2, CVE-1 |
| CORS/CSP misconfiguration | Not yet tested |
| Secrets exposure risk | Not yet tested |
| Rate limiting absent on endpoints | Not yet tested |
| Verbose error leakage | Not yet tested |

## Findings

### dependency

### DEP-002 - Critical vuln
**Severity:** critical  
**Status:** vulnerable  
**Category:** dependency

desc

**Reproduction:**
1. step1

**Evidence:**
- Expected: safe
- Actual: unsafe

**CVE:** CVE-2
**Affected feature:** API

**Remediation:** upgrade

### DEP-001 - High vuln
**Severity:** high  
**Status:** vulnerable  
**Category:** dependency

desc

**Reproduction:**
1. step1
2. step2

**Evidence:**
- Expected: safe
- Actual: unsafe

**CVE:** CVE-1
**Affected feature:** Frontend

**Remediation:** upgrade

### DEP-000 - No high or critical CVEs found
**Severity:** info  
**Status:** pass  
**Category:** dependency

desc

**Reproduction:**
1. step1

**Evidence:**
- Expected: safe
- Actual: safe

**Remediation:** none

`;

  assert.equal(content, expected);
});

test('markdown reporter orders findings by severity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-md-order-'));
  const file = await writeMarkdown(fixtureReport(), dir);
  const content = await readFile(file, 'utf8');
  const criticalIndex = content.indexOf('### DEP-002 - Critical vuln');
  const highIndex = content.indexOf('### DEP-001 - High vuln');
  const infoIndex = content.indexOf('### DEP-000 - No high or critical CVEs found');

  assert.ok(criticalIndex >= 0);
  assert.ok(highIndex > criticalIndex);
  assert.ok(infoIndex > highIndex);
});
