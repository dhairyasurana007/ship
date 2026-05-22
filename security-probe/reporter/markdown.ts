import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Category, Finding, Report, Severity } from '../types.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CATEGORIES: Category[] = [
  'auth',
  'websocket',
  'input',
  'dependency',
  'cors-csp',
  'secrets',
  'rate-limiting',
  'error-verbosity'
];

function byCategory(findings: Finding[], category: Category): Finding[] {
  return findings
    .filter((f) => f.category === category)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function summaryCell(findings: Finding[], category: Category): string {
  const categoryFindings = byCategory(findings, category);
  if (categoryFindings.length === 0) {
    return 'Not yet tested';
  }
  const vulnerable = categoryFindings.filter((f) => f.status === 'vulnerable');
  if (vulnerable.length === 0) {
    return 'None found';
  }
  return vulnerable.map((f) => `${f.id} (${f.severity})`).join(', ');
}

function boolCell(findings: Finding[], category: Category): string {
  const categoryFindings = byCategory(findings, category);
  if (categoryFindings.length === 0) {
    return 'Not yet tested';
  }
  const vulnerable = categoryFindings.filter((f) => f.status === 'vulnerable');
  if (vulnerable.length === 0) {
    return 'No';
  }
  return `Yes - ${vulnerable.map((f) => f.title).join('; ')}`;
}

function renderFinding(finding: Finding): string {
  const lines = [
    `### ${finding.id} - ${finding.title}`,
    `**Severity:** ${finding.severity}  `,
    `**Status:** ${finding.status}  `,
    `**Category:** ${finding.category}`,
    '',
    finding.description,
    '',
    '**Reproduction:**'
  ];

  for (const [index, line] of finding.reproduction.split('\n').entries()) {
    lines.push(`${index + 1}. ${line}`);
  }

  lines.push('');
  lines.push('**Evidence:**');
  lines.push(`- Expected: ${finding.evidence.expected}`);
  lines.push(`- Actual: ${finding.evidence.actual}`);

  if (finding.cve) {
    lines.push('');
    lines.push(`**CVE:** ${finding.cve}`);
  }
  if (finding.affectedFeature) {
    lines.push(`**Affected feature:** ${finding.affectedFeature}`);
  }

  lines.push('');
  lines.push(`**Remediation:** ${finding.remediation}`);
  lines.push('');

  return lines.join('\n');
}

export async function writeMarkdown(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.md'));

  const depVulnerable = byCategory(report.findings, 'dependency').filter(
    (f) => f.status === 'vulnerable'
  );
  const cveList = depVulnerable.map((f) => f.cve).filter(Boolean).join(', ');
  const depSummaryCell =
    depVulnerable.length === 0 ? 'None found ✓' : `${depVulnerable.length} - ${cveList || 'None found ✓'}`;

  const lines = [
    '# Shipshape Security Audit Report',
    '',
    `Generated: ${report.generated}`,
    `Target: ${report.target}`,
    '',
    '## Summary',
    '',
    '| Metric | Result |',
    '|--------|--------|',
    '| Security probe tool | Runnable |',
    `| Auth/session vulnerabilities | ${summaryCell(report.findings, 'auth')} |`,
    `| WebSocket validation failures | ${summaryCell(report.findings, 'websocket')} |`,
    `| Input sanitization failures | ${summaryCell(report.findings, 'input')} |`,
    `| High/Critical CVEs in dependencies | ${depSummaryCell} |`,
    `| CORS/CSP misconfiguration | ${boolCell(report.findings, 'cors-csp')} |`,
    `| Secrets exposure risk | ${boolCell(report.findings, 'secrets')} |`,
    `| Rate limiting absent on endpoints | ${summaryCell(report.findings, 'rate-limiting')} |`,
    `| Verbose error leakage | ${boolCell(report.findings, 'error-verbosity')} |`,
    '',
    '## Findings',
    ''
  ];

  for (const category of CATEGORIES) {
    const categoryFindings = byCategory(report.findings, category);
    if (categoryFindings.length === 0) {
      continue;
    }
    lines.push(`### ${category}`);
    lines.push('');
    for (const finding of categoryFindings) {
      lines.push(renderFinding(finding));
    }
  }

  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}
