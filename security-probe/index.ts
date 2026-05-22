#!/usr/bin/env tsx
import { parseConfig } from './config.js';
import { writeJson } from './reporter/json.js';
import { writeMarkdown } from './reporter/markdown.js';
import { run } from './runner.js';
import type { Category } from './types.js';

async function ensureTargetReachable(target: string, timeoutMs: number): Promise<boolean> {
  const urls = [`${target}/health`, target];
  for (const url of urls) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return true;
    } catch {
      // try next URL candidate
    }
  }
  return false;
}

const config = parseConfig();
const reachable = await ensureTargetReachable(config.target, config.timeout);
if (!reachable) {
  console.error(`Target unreachable: ${config.target}`);
  console.error('Security report was not generated.');
  process.exit(1);
}

console.log('');
const report = await run(config);

const [jsonPath, markdownPath] = await Promise.all([
  writeJson(report, config.output),
  writeMarkdown(report, config.output)
]);

const categories: Category[] = [
  'auth',
  'websocket',
  'input',
  'dependency',
  'cors-csp',
  'secrets',
  'rate-limiting',
  'error-verbosity'
];

console.log('Shipshape Security Probe');
console.log(`Target : ${report.target}`);
console.log(`Run at : ${report.generated}`);
console.log('');
console.log('Category      Tests  Vulnerable  Inconclusive');
console.log('------------  -----  ----------  ------------');

let rows = 0;
for (const category of categories) {
  const matching = report.findings.filter((f) => f.category === category);
  if (matching.length === 0) {
    continue;
  }
  rows += 1;
  const vulnerable = matching.filter((f) => f.status === 'vulnerable').length;
  const inconclusive = matching.filter((f) => f.status === 'inconclusive').length;
  console.log(
    `${category.padEnd(12)}  ${String(matching.length).padStart(5)}  ${String(vulnerable).padStart(10)}  ${String(inconclusive).padStart(12)}`
  );
}

if (rows === 0) {
  console.log('(empty)');
}

console.log('');
console.log('Reports written:');
console.log(`  ${jsonPath}`);
console.log(`  ${markdownPath}`);

const surfacedFindings = report.findings.filter(
  (f) => f.status === 'vulnerable' || f.status === 'inconclusive'
);
if (surfacedFindings.length > 0) {
  const printTable = (title: string, rows: typeof surfacedFindings): void => {
    if (rows.length === 0) return;
    console.log('');
    console.log(title);
    console.log('ID        Status        Severity  Category      Title');
    console.log('--------  ------------  --------  ------------  ----------------------------------------');
    for (const finding of rows) {
      const id = finding.id.padEnd(8);
      const status = finding.status.padEnd(12);
      const severity = finding.severity.padEnd(8);
      const category = finding.category.padEnd(12);
      console.log(`${id}  ${status}  ${severity}  ${category}  ${finding.title}`);
    }
  };

  const categoryTitles: Record<Category, string> = {
    dependency: 'Dependency Vulnerabilities',
    auth: 'Authentication Vulnerabilities',
    websocket: 'WebSocket Vulnerabilities',
    input: 'Input Sanitization Vulnerabilities',
    'cors-csp': 'CORS/CSP Vulnerabilities',
    secrets: 'Secrets Exposure Vulnerabilities',
    'rate-limiting': 'Rate Limiting Vulnerabilities',
    'error-verbosity': 'Error Verbosity Vulnerabilities'
  };

  const categoriesInDisplayOrder: Category[] = [
    'dependency',
    'auth',
    'websocket',
    'input',
    'cors-csp',
    'secrets',
    'rate-limiting',
    'error-verbosity'
  ];

  for (const category of categoriesInDisplayOrder) {
    const rows = surfacedFindings.filter((f) => f.category === category);
    printTable(categoryTitles[category], rows);
  }
}

console.log('');
