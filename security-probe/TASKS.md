# Shipshape Security Probe — TASKS.md

Commits go: nothing → prototype → final tool. Each commit leaves the tool runnable and testable.

---

## Guardrails (read before implementing any commit)

- **Import extensions:** Use `.js` in all TypeScript import statements — `moduleResolution: NodeNext` requires it. Write `import { foo } from './foo.js'` even though the file is `foo.ts`.
- **No new dependencies:** Do not add npm packages beyond what is listed in `security-probe/package.json` at each commit.
- **No external HTTP libraries:** Use native `fetch` only. Do not use axios, node-fetch, or got.
- **ES modules only:** `"type": "module"` is set. Do not use `require()` or `module.exports`.
- **No imports outside `security-probe/`:** The tool is a standalone package. Do not import from `../api`, `../web`, or `../shared`.
- **Probes never throw:** Every probe function catches its own errors and returns a `Finding` with `status: 'inconclusive'` and the error message in `evidence.actual`. The runner must never crash due to a probe failure.
- **Teardown always runs:** Use `try/finally` in any probe that creates remote resources.
- **Sequential requests in rate-limit probe:** Use `for` loops with `await`, never `Promise.all`, to avoid accidentally triggering real DDoS protection.
- **Do NOT touch anything OUTSIDE of security-probe folder:** All changes must happen WITHIN security-probe folder. 

---

## PROTOTYPE

---

### Commit 1 — Scaffold

**Goal:** Installable CLI that runs end-to-end with an empty report. Validates the package setup, config parsing, and reporter pipeline before any probes exist.

---

#### `security-probe/package.json`

```json
{
  "name": "ship-security-probe",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "ship-security-probe": "./index.ts"
  },
  "dependencies": {
    "tough-cookie": "^4.1.4",
    "tsx": "^4.19.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/tough-cookie": "^4.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.0.0"
  }
}
```

Note: `tsx` is in `dependencies` (not devDependencies) so the shebang works after global install.

---

#### `security-probe/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

#### `security-probe/types.ts`

No logic. Export only.

```typescript
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category =
  | 'auth'
  | 'websocket'
  | 'input'
  | 'dependency'
  | 'cors-csp'
  | 'secrets'
  | 'rate-limiting'
  | 'error-verbosity';

export type Status = 'vulnerable' | 'pass' | 'inconclusive';

export interface Finding {
  id: string;
  category: Category;
  title: string;
  severity: Severity;
  status: Status;
  description: string;
  reproduction: string;
  evidence: {
    request?: string;
    response?: string;
    expected: string;
    actual: string;
  };
  remediation: string;
  cve?: string;
  affectedFeature?: string;
}

export interface Report {
  generated: string;   // ISO 8601, e.g. "2026-05-21T14:30:00.000Z"
  target: string;
  summary: {
    total: number;
    vulnerable: number;
    passed: number;
    inconclusive: number;
    bySeverity: Record<Severity, number>;
    byCategory: Partial<Record<Category, number>>;
  };
  findings: Finding[];
}
```

---

#### `security-probe/config.ts`

```typescript
import { parseArgs } from 'node:util';

export interface Config {
  target: string;
  output: string;
  verbose: boolean;
  timeout: number;
  repo: string | null;
  adminEmail: string | null;
  adminPassword: string | null;
}

export function parseConfig(): Config {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output:           { type: 'string',  default: '.' },
      verbose:          { type: 'boolean', default: false },
      timeout:          { type: 'string',  default: '10000' },
      repo:             { type: 'string' },
      'admin-email':    { type: 'string' },
      'admin-password': { type: 'string' },
    },
  });

  const target = positionals[0];
  if (!target) {
    console.error('Usage: ship-security-probe <target-url>');
    console.error('Example: ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com');
    process.exit(1);
  }

  return {
    target: target.replace(/\/$/, ''),
    output:        values.output as string,
    verbose:       values.verbose as boolean,
    timeout:       parseInt(values.timeout as string, 10),
    repo:          (values.repo as string | undefined) ?? null,
    adminEmail:    (values['admin-email'] as string | undefined) ?? null,
    adminPassword: (values['admin-password'] as string | undefined) ?? null,
  };
}
```

Note: Current bootstrap flow auto-registers generated credentials and does not require extra CLI flags for normal runs.

---

#### `security-probe/runner.ts` — full file, Commit 1 state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;

  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;

  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity,
    byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  // Probes added here in later commits.

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### `security-probe/reporter/json.ts`

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Report } from '../types.js';

export async function writeJson(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.json'));
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
```

---

#### `security-probe/reporter/markdown.ts` — stub, replaced in Commit 3

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Report } from '../types.js';

export async function writeMarkdown(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.md'));
  const content = `# Shipshape Security Audit Report\n\nGenerated: ${report.generated}\nTarget: ${report.target}\n\nNo findings yet.\n`;
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
```

---

#### `security-probe/index.ts`

Shebang must be line 1 with no blank line before it.

```typescript
#!/usr/bin/env tsx
import { parseConfig } from './config.js';
import { run } from './runner.js';
import { writeJson } from './reporter/json.js';
import { writeMarkdown } from './reporter/markdown.js';
import type { Category } from './types.js';

const config = parseConfig();
const report = await run(config);
const [jsonPath, mdPath] = await Promise.all([
  writeJson(report, config.output),
  writeMarkdown(report, config.output),
]);

const CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

console.log('\nShipshape Security Probe');
console.log(`Target : ${report.target}`);
console.log(`Run at : ${report.generated}`);
console.log('');
console.log('Category         Tests  Vulnerable  Inconclusive');
console.log('---------------  -----  ----------  ------------');

for (const cat of CATEGORIES) {
  const cf = report.findings.filter(f => f.category === cat);
  if (cf.length === 0) continue;
  const vuln = cf.filter(f => f.status === 'vulnerable').length;
  const inc  = cf.filter(f => f.status === 'inconclusive').length;
  console.log(`${cat.padEnd(17)}${String(cf.length).padStart(5)}  ${String(vuln).padStart(10)}  ${String(inc).padStart(12)}`);
}

console.log('');
console.log('Reports written:');
console.log(' ', jsonPath);
console.log(' ', mdPath);
```

---

#### User verification steps

```bash
cd security-probe
npm install
npm install -g .
cd ..
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- Prints header + empty category table + two report paths. Exit 0.
- `security-probe-report.json` is valid JSON with `findings: []`
- `security-probe-report.md` contains "No findings yet."

---

#### GitHub Actions test cases
- CI-safe: typecheck and CLI smoke (
px tsc --noEmit, run command against mock URL).
- Assert JSON report parses and markdown report is created.

### Commit 2 — Dependency Probe

**Goal:** Prototype complete. Shells out to `pnpm audit`, parses CVEs, produces real findings.

---

#### `security-probe/probes/deps.ts` — new file

```typescript
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, 'pnpm-lock.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(
      'Could not find pnpm-lock.yaml. Run from inside the Ship repo.'
    );
    current = parent;
  }
}

function mapPackageToFeature(repoRoot: string, moduleName: string): string {
  const featureMap: Array<{ fragment: string; label: string }> = [
    { fragment: 'api/src/routes/auth',      label: 'Authentication' },
    { fragment: 'api/src/routes/documents', label: 'Document editing' },
    { fragment: 'api/src/collaboration',    label: 'Real-time collaboration' },
    { fragment: 'api/src/routes/files',     label: 'File uploads' },
    { fragment: 'api/src/routes/issues',    label: 'Issues' },
    { fragment: 'web/src',                  label: 'Frontend' },
    { fragment: 'api/src',                  label: 'API' },
  ];

  let grepOutput = '';
  try {
    grepOutput = execSync(
      `grep -r --include="*.ts" -l "from '${moduleName}'" "${repoRoot}"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch { /* grep exits 1 on no matches — not an error */ }

  for (const { fragment, label } of featureMap) {
    if (grepOutput.includes(fragment)) return label;
  }
  return 'Unknown feature';
}

interface PnpmAdvisory {
  id: number;
  title: string;
  module_name: string;
  severity: string;
  cves: string[];
  vulnerable_versions: string;
  patched_versions: string;
  overview: string;
  findings: Array<{ version: string }>;
}

export async function probeDeps(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  try {
    const repoRoot = config.repo ?? findRepoRoot(process.cwd());

    let stdout = '';
    try {
      stdout = execSync('pnpm audit --json', {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
    } catch (err: unknown) {
      // pnpm audit exits 1 when vulnerabilities found — that's expected
      stdout = (err as { stdout?: string }).stdout ?? '';
    }

    if (!stdout.trim()) {
      return [{
        id: 'DEP-000', category: 'dependency',
        title: 'pnpm audit returned no output',
        severity: 'info', status: 'inconclusive',
        description: 'pnpm audit produced no JSON output.',
        reproduction: `cd ${repoRoot} && pnpm audit --json`,
        evidence: { expected: 'JSON output', actual: '(empty)' },
        remediation: 'Ensure pnpm is installed and node_modules are present.',
      }];
    }

    const parsed = JSON.parse(stdout) as { advisories?: Record<string, PnpmAdvisory> };
    const advisories = Object.values(parsed.advisories ?? {});
    const highOrCritical = advisories.filter(a => a.severity === 'high' || a.severity === 'critical');

    if (highOrCritical.length === 0) {
      results.push({
        id: 'DEP-000', category: 'dependency',
        title: 'No high or critical CVEs found',
        severity: 'info', status: 'pass',
        description: 'pnpm audit found no high or critical advisories.',
        reproduction: `cd ${repoRoot} && pnpm audit`,
        evidence: {
          expected: 'No high/critical advisories',
          actual: `${advisories.length} total advisories, 0 high/critical`,
        },
        remediation: 'No action required.',
      });
      return results;
    }

    highOrCritical.forEach((advisory, index) => {
      const affectedVersion = advisory.findings[0]?.version ?? 'unknown';
      const feature = mapPackageToFeature(repoRoot, advisory.module_name);
      results.push({
        id: `DEP-${String(index + 1).padStart(3, '0')}`,
        category: 'dependency',
        title: advisory.title,
        severity: advisory.severity === 'critical' ? 'critical' : 'high',
        status: 'vulnerable',
        description: advisory.overview,
        reproduction: [
          `cd ${repoRoot}`,
          'pnpm audit',
          `Advisory ID: ${advisory.id}`,
          `Package: ${advisory.module_name}@${affectedVersion}`,
        ].join('\n'),
        evidence: {
          expected: `${advisory.module_name} >= ${advisory.patched_versions}`,
          actual: `${advisory.module_name}@${affectedVersion} (vulnerable: ${advisory.vulnerable_versions})`,
        },
        remediation: `Upgrade ${advisory.module_name} to ${advisory.patched_versions}:\n  pnpm update ${advisory.module_name}`,
        cve: advisory.cves[0] ?? undefined,
        affectedFeature: feature,
      });
    });
  } catch (err: unknown) {
    results.push({
      id: 'DEP-ERR', category: 'dependency',
      title: 'Dependency probe failed',
      severity: 'info', status: 'inconclusive',
      description: 'The dependency probe encountered an unexpected error.',
      reproduction: 'Run ship-security-probe and review console logs for details.',
      evidence: {
        expected: 'Successful pnpm audit run',
        actual: err instanceof Error ? err.message : String(err),
      },
      remediation: 'Check that pnpm is installed and the repo path is correct.',
    });
  }

  return results;
}
```

---

#### `security-probe/runner.ts` — full file, Commit 2 state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';
import { probeDeps } from './probes/deps.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;
  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity,
    byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  const depFindings = await probeDeps(config);
  findings.push(...depFindings);

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- DEP row appears in summary table
- `security-probe-report.json` has at least one finding with `category: "dependency"`
- If CVEs found: each finding has `cve`, `affectedFeature`, `reproduction`, `remediation` populated
- If no CVEs: one `pass` finding with `id: "DEP-000"`
- Tool does not crash when pnpm audit exits with code 1

---

#### GitHub Actions test cases
- Mock pnpm audit output; verify parser keeps only high/critical and handles non-zero exit.
- Assert dependency findings schema and summary counts.

### Commit 3 — Full Reporter

**Goal:** Markdown report matches the spec's audit deliverable table exactly.

---

#### `security-probe/reporter/markdown.ts` — replaces stub, full file

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Report, Finding, Severity, Category } from '../types.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function byCategory(findings: Finding[], cat: Category): Finding[] {
  return findings
    .filter(f => f.category === cat)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function summaryCell(findings: Finding[], cat: Category): string {
  const cf = byCategory(findings, cat);
  if (cf.length === 0) return 'Not yet tested';
  const vulns = cf.filter(f => f.status === 'vulnerable');
  if (vulns.length === 0) return 'None found ✓';
  return vulns.map(f => `${f.id} (${f.severity})`).join(', ');
}

function boolCell(findings: Finding[], cat: Category): string {
  const cf = byCategory(findings, cat);
  if (cf.length === 0) return 'Not yet tested';
  const vulns = cf.filter(f => f.status === 'vulnerable');
  return vulns.length === 0 ? 'No ✓' : `Yes — ${vulns.map(f => f.title).join('; ')}`;
}

function renderFinding(f: Finding): string {
  const lines = [
    `### ${f.id} — ${f.title}`,
    `**Severity:** ${f.severity}  `,
    `**Status:** ${f.status}  `,
    `**Category:** ${f.category}`,
    '',
    f.description,
    '',
    '**Reproduction:**',
    ...f.reproduction.split('\n').map((line, i) => `${i + 1}. ${line}`),
    '',
    '**Evidence:**',
    `- Expected: ${f.evidence.expected}`,
    `- Actual: ${f.evidence.actual}`,
  ];
  if (f.evidence.request)  lines.push('', '```', f.evidence.request,  '```');
  if (f.evidence.response) lines.push('', '```', f.evidence.response, '```');
  if (f.cve)              lines.push('', `**CVE:** ${f.cve}`);
  if (f.affectedFeature)  lines.push(`**Affected feature:** ${f.affectedFeature}`);
  lines.push('', `**Remediation:** ${f.remediation}`, '');
  return lines.join('\n');
}

export async function writeMarkdown(report: Report, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = resolve(join(outputDir, 'security-probe-report.md'));

  const depVulns = byCategory(report.findings, 'dependency').filter(f => f.status === 'vulnerable');
  const cveList  = depVulns.map(f => f.cve).filter(Boolean).join(', ') || 'None';

  const lines = [
    '# Shipshape Security Audit Report',
    '',
    `**Generated:** ${report.generated}  `,
    `**Target:** ${report.target}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    '| Metric | Result |',
    '|--------|--------|',
    `| Security probe tool | Runnable ✓ |`,
    `| Auth/session vulnerabilities | ${summaryCell(report.findings, 'auth')} |`,
    `| WebSocket validation failures | ${summaryCell(report.findings, 'websocket')} |`,
    `| Input sanitization failures | ${summaryCell(report.findings, 'input')} |`,
    `| High/Critical CVEs in dependencies | ${depVulns.length} — ${cveList} |`,
    `| CORS/CSP misconfiguration | ${boolCell(report.findings, 'cors-csp')} |`,
    `| Secrets exposure risk | ${boolCell(report.findings, 'secrets')} |`,
    `| Rate limiting absent on endpoints | ${summaryCell(report.findings, 'rate-limiting')} |`,
    `| Verbose error leakage | ${boolCell(report.findings, 'error-verbosity')} |`,
    '',
    '---',
    '',
    '## Findings',
    '',
  ];

  const CATS: Category[] = [
    'auth', 'websocket', 'input', 'dependency',
    'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
  ];

  for (const cat of CATS) {
    const cf = byCategory(report.findings, cat);
    if (cf.length === 0) continue;
    lines.push(`### ${cat}`, '');
    for (const f of cf) lines.push(renderFinding(f));
  }

  await writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
cat security-probe-report.md
```

Expected:
- All 9 rows present in the Summary table
- Dep row shows CVE IDs or "None found ✓"
- All other rows show "Not yet tested"
- Each DEP finding renders with all fields

---

#### GitHub Actions test cases
- Snapshot markdown output from a fixed report fixture.
- Verify severity ordering and Not yet tested behavior for missing categories.

## FINAL TOOL

---

### Commit 4 — HTTP Client

**Goal:** Shared authenticated HTTP client with cookie jar. All subsequent probes use this.

---

#### `security-probe/http-client.ts` — new file

```typescript
import { CookieJar } from 'tough-cookie';
import type { Config } from './config.js';

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
  const { target, timeout, verbose } = config;
  const jar = new CookieJar();

  async function request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const url = `${target}${path}`;
    const cookies = await jar.getCookies(target);
    const cookieStr = cookies.map(c => `${c.key}=${c.value}`).join('; ');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(cookieStr ? { Cookie: cookieStr } : {}),
      ...extraHeaders,
    };

    if (verbose) process.stderr.write(`→ ${method} ${path}\n`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Store any Set-Cookie headers
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      await jar.setCookie(cookie, target).catch(() => {});
    }

    if (verbose) process.stderr.write(`← ${response.status} ${path}\n`);
    return response;
  }

  return {
    get:   (path, h) => request('GET',    path, undefined, h),
    post:  (path, b, h) => request('POST',   path, b, h),
    patch: (path, b, h) => request('PATCH',  path, b, h),
    del:   (path, h) => request('DELETE', path, undefined, h),

    async login(email, password) {
      const res = await request('POST', '/api/auth/login', { email, password });
      return res.ok;
    },

    async logout() {
      await request('POST', '/api/auth/logout').catch(() => {});
      await jar.removeAllCookies();
    },

    clearSession() { jar.removeAllCookiesSync(); },

    getSessionCookieHeader() {
      return jar.getCookiesSync(target).map(c => `${c.key}=${c.value}`).join('; ');
    },
  };
}
```

---

#### User verification steps

Type-check only:

```bash
cd security-probe && npx tsc --noEmit
```

Expected: zero errors.

---

#### GitHub Actions test cases
- Use mock HTTP server to test cookie jar propagation, timeout aborts, and verbose logs.
- Assert helper methods (login, logout, getCookies) behavior.

### Commit 5 - Auth Probe

**Goal:** Implement auth/session probe with bootstrap auto-registration and runtime admin setup checks. Core finding set is `AUTH-001` to `AUTH-009`, with conditional setup findings when bootstrap/admin readiness is not achieved.

---

#### Implemented behavior (current)
- Generates and prints throwaway member test credentials (`probe-test-*`) and bootstrap credentials (`probe-test-*`).
- Calls `POST /api/auth/register` with generated bootstrap credentials.
- Calls internal elevation endpoint when token is available:
  - `POST /api/internal/probe/elevate-admin`
  - `Authorization: Bearer ${PROBE_INTERNAL_ELEVATION_TOKEN}`
  - body `{ email, ttlMinutes: 10 }`
- Waits (`1500ms`) between register/elevate and bootstrap login.
- Logs in with bootstrap credentials for runtime checks.
- Verifies privileged readiness by retrying `GET /api/admin/users` up to 4 times.
- Creates throwaway member user for member-role checks, then always attempts teardown in `finally`.

---

#### Finding IDs and counts
- Base auth tests: `AUTH-001` to `AUTH-009`.
- Conditional setup findings:
  - `AUTH-000` (`inconclusive`): bootstrap login failed.
  - `AUTH-SETUP` (`inconclusive`): bootstrap login succeeded but admin verification failed.

Expected count behavior:
- Typical successful path: 9 findings (`AUTH-001`..`AUTH-009`).
- If bootstrap login fails: returns only `AUTH-000`.
- If bootstrap login succeeds but admin verification fails: includes `AUTH-SETUP`; member-dependent checks may be inconclusive.

---

#### `security-probe/runner.ts` note for current repo state
- Current codebase runner already includes `probeWebSocket` in addition to deps+auth.
- Commit sections are historical milestones; live runner may include later-commit wiring.

---

#### User verification steps

```bash
cd security-probe
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected on configured target:
- Console shows bootstrap register + elevate flow:
  - `Auth probe: attempting bootstrap auto-register...`
  - `Auth probe: requesting internal bootstrap admin elevation...` (if token set)
  - `Auth probe: bootstrap admin access verified.`
- Auth findings include `AUTH-001`..`AUTH-009` on successful admin-ready path.
- Throwaway member user is cleaned up in `finally` (best-effort delete).

---

#### GitHub Actions test cases (under auth workflow)
- Mock auth endpoints and assert:
  - `AUTH-001`..`AUTH-009` emitted on success path.
  - `AUTH-SETUP` emitted when admin verification is not confirmed.
  - `AUTH-000` behavior when bootstrap login cannot be established.
- Verify bootstrap credential generation/use and `finally` teardown delete call.
### Commit 6 — WebSocket Probe

**Goal:** 8 WebSocket tests against the live collaboration endpoint.
Bootstrap precondition behavior:
- If bootstrap authentication fails, the probe returns a single WS-000 finding (inconclusive) and does not execute WS-001 through WS-008.


---

#### `security-probe/probes/websocket.ts` — new file

```typescript
import WebSocket from 'ws';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { createHttpClient } from '../http-client.js';

const TEST_USER_EMAIL    = `probe-ws-${Date.now()}@probe.local`;
const TEST_USER_PASSWORD = 'ProbePass123!';

function wsBase(target: string): string {
  return target.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

async function serverAlive(target: string, timeout: number): Promise<boolean> {
  try {
    const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch { return false; }
}

function connect(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ws: WebSocket; httpStatus?: number; error?: string }> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { ws.terminate(); resolve({ ws }); }, timeoutMs);
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { clearTimeout(timer); resolve({ ws }); });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer); resolve({ ws, httpStatus: res.statusCode });
    });
    ws.on('error', err => { clearTimeout(timer); resolve({ ws, error: err.message }); });
  });
}

export async function probeWebSocket(config: Config): Promise<Finding[]> {

  const results: Finding[] = [];
  const base = wsBase(config.target);
  const admin = createHttpClient(config);
  // Bootstrap login credentials are auto-registered and generated at runtime.

  let docId: string | null = null;
  let privateDocId: string | null = null;
  let testUserId: string | null = null;

  try {
    // Create test document
    const dr = await admin.post('/api/documents', { title: 'probe-ws', document_type: 'wiki' });
    if (dr.ok) docId = ((await dr.json()) as { data?: { id?: string } })?.data?.id ?? null;

    // Create private document for WS-008
    const pr = await admin.post('/api/documents', { title: 'probe-ws-private', document_type: 'wiki', visibility: 'private' });
    if (pr.ok) privateDocId = ((await pr.json()) as { data?: { id?: string } })?.data?.id ?? null;

    // Create member test user for WS-008
    const ur = await admin.post('/api/admin/users', { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD, role: 'member' });
    if (ur.ok) testUserId = ((await ur.json()) as { data?: { id?: string } })?.data?.id ?? null;

    const cookie = admin.getSessionCookieHeader();
    const wsUrl  = docId ? `${base}/collaboration/wiki:${docId}` : `${base}/collaboration/wiki:probe`;

    // WS-001: No auth
    {
      const { httpStatus } = await connect(wsUrl, {}, config.timeout);
      results.push({
        id: 'WS-001', category: 'websocket',
        title: 'Unauthenticated WebSocket connection accepted',
        severity: 'high',
        status: (httpStatus === 401 || httpStatus === 403) ? 'pass' : 'vulnerable',
        description: 'WS upgrade without auth should be rejected with HTTP 401.',
        reproduction: `Connect to ${wsUrl} with no Cookie header.`,
        evidence: {
          expected: 'HTTP 401 during upgrade',
          actual: httpStatus ? `HTTP ${httpStatus}` : 'Connection opened (not rejected)',
        },
        remediation: 'Validate session cookie during WebSocket upgrade handshake.',
      });
    }

    // WS-002: Non-existent document
    {
      const { httpStatus, ws } = await connect(`${base}/collaboration/wiki:nonexistent-probe-00000`, { Cookie: cookie }, config.timeout);
      ws.terminate();
      results.push({
        id: 'WS-002', category: 'websocket',
        title: 'WebSocket accepts connection to non-existent document',
        severity: 'medium',
        status: (httpStatus && httpStatus >= 400) ? 'pass' : 'vulnerable',
        description: 'Connecting to a non-existent document should be rejected.',
        reproduction: `Connect to ${base}/collaboration/wiki:nonexistent-probe-00000 with valid auth.`,
        evidence: {
          expected: 'HTTP 404 or close code 4404',
          actual: httpStatus ? `HTTP ${httpStatus}` : 'Connection opened',
        },
        remediation: 'Validate document existence before completing WebSocket upgrade.',
      });
    }

    // WS-003: Oversized message
    if (docId) {
      const { ws } = await connect(wsUrl, { Cookie: cookie }, config.timeout);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.alloc(11 * 1024 * 1024));
        await new Promise(r => setTimeout(r, 2000));
        ws.terminate();
      }
      const alive = await serverAlive(config.target, config.timeout);
      results.push({
        id: 'WS-003', category: 'websocket',
        title: 'Oversized WebSocket message crashes server',
        severity: 'high', status: alive ? 'pass' : 'vulnerable',
        description: 'Sending an 11 MB message should not crash the server.',
        reproduction: `1. Connect to ${wsUrl}\n2. ws.send(Buffer.alloc(11 * 1024 * 1024))\n3. GET /health`,
        evidence: { expected: '/health returns 200', actual: alive ? 'Server alive' : 'Server unreachable' },
        remediation: 'Enforce a maximum message size in the WebSocket server.',
      });
    }

    // WS-004: Invalid Yjs bytes
    if (docId) {
      const { ws } = await connect(wsUrl, { Cookie: cookie }, config.timeout);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from([0xFF, 0xFE, 0x00, 0x01, ...Array.from({ length: 256 }, () => Math.floor(Math.random() * 256))]));
        await new Promise(r => setTimeout(r, 1000));
        ws.terminate();
      }
      const alive = await serverAlive(config.target, config.timeout);
      results.push({
        id: 'WS-004', category: 'websocket',
        title: 'Invalid Yjs bytes crash server',
        severity: 'high', status: alive ? 'pass' : 'vulnerable',
        description: 'Malformed Yjs bytes should be ignored or close the connection, not crash the server.',
        reproduction: `1. Connect to ${wsUrl}\n2. Send 260 garbage bytes\n3. GET /health`,
        evidence: { expected: 'Server alive', actual: alive ? 'Server alive' : 'Server unreachable' },
        remediation: 'Wrap Yjs message parsing in try/catch; close connection on parse error.',
      });
    }

    // WS-005: Unknown message type
    if (docId) {
      const { ws } = await connect(wsUrl, { Cookie: cookie }, config.timeout);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from([99]));
        await new Promise(r => setTimeout(r, 1000));
        ws.terminate();
      }
      const alive = await serverAlive(config.target, config.timeout);
      results.push({
        id: 'WS-005', category: 'websocket',
        title: 'Unknown message type causes server instability',
        severity: 'medium', status: alive ? 'pass' : 'vulnerable',
        description: 'A message with type byte 99 (outside 0–3) should be silently ignored.',
        reproduction: `1. Connect to ${wsUrl}\n2. Send Buffer.from([99])\n3. GET /health`,
        evidence: { expected: 'Server alive', actual: alive ? 'Server alive' : 'Server unreachable' },
        remediation: 'Add a default case to the message-type switch that closes the connection gracefully.',
      });
    }

    // WS-006: Connection flood
    {
      let firstRejected = -1;
      const sockets: WebSocket[] = [];
      for (let i = 0; i < 35; i++) {
        const { ws, httpStatus } = await connect(wsUrl, { Cookie: cookie }, 3000);
        sockets.push(ws);
        if (httpStatus === 429 && firstRejected === -1) firstRejected = i + 1;
      }
      sockets.forEach(s => s.terminate());
      results.push({
        id: 'WS-006', category: 'websocket',
        title: 'WebSocket connection flood not rate-limited',
        severity: 'high', status: firstRejected !== -1 ? 'pass' : 'vulnerable',
        description: '35 rapid connections from one IP should trigger rate limiting.',
        reproduction: 'Open 35 WebSocket connections in rapid succession.',
        evidence: {
          expected: 'HTTP 429 before connection 31',
          actual: firstRejected === -1 ? 'No 429 after 35 connections' : `First 429 at connection ${firstRejected}`,
        },
        remediation: 'Apply connection-rate limiting per IP on WebSocket upgrade.',
      });
    }

    // WS-007: Message flood
    if (docId) {
      let closed = false;
      const { ws } = await connect(wsUrl, { Cookie: cookie }, config.timeout);
      if (ws.readyState === WebSocket.OPEN) {
        ws.on('close', () => { closed = true; });
        for (let i = 0; i < 60; i++) ws.send(Buffer.alloc(1));
        await new Promise(r => setTimeout(r, 2000));
        ws.terminate();
      }
      results.push({
        id: 'WS-007', category: 'websocket',
        title: 'WebSocket message flood not rate-limited',
        severity: 'medium', status: closed ? 'pass' : 'vulnerable',
        description: '60 messages in under 1 second should trigger per-connection rate limiting.',
        reproduction: `1. Connect to ${wsUrl}\n2. Send 60 empty buffers in a tight loop`,
        evidence: {
          expected: 'Connection closed by server',
          actual: closed ? 'Connection closed by server' : 'Connection remained open',
        },
        remediation: 'Enforce per-connection message rate limit (e.g. 50 msg/sec).',
      });
    }

    // WS-008: Cross-user private document access
    if (privateDocId && testUserId) {
      const member = createHttpClient(config);
      await member.login(TEST_USER_EMAIL, TEST_USER_PASSWORD);
      const memberCookie = member.getSessionCookieHeader();
      const { httpStatus } = await connect(`${base}/collaboration/wiki:${privateDocId}`, { Cookie: memberCookie }, config.timeout);
      await member.logout();
      results.push({
        id: 'WS-008', category: 'websocket',
        title: "Member can connect to another user's private document",
        severity: 'high',
        status: (httpStatus === 403 || httpStatus === 4403) ? 'pass' : 'vulnerable',
        description: 'A member should not open a WebSocket to a private document they do not own.',
        reproduction: `1. Admin creates private doc\n2. ${TEST_USER_EMAIL} connects to ${base}/collaboration/wiki:${privateDocId}`,
        evidence: {
          expected: 'HTTP 403 or close code 4403',
          actual: httpStatus ? `Code ${httpStatus}` : 'Connection opened',
        },
        remediation: 'Check document visibility during WebSocket upgrade.',
      });
    }

  } finally {
    if (docId)        await admin.del(`/api/documents/${docId}`).catch(() => {});
    if (privateDocId) await admin.del(`/api/documents/${privateDocId}`).catch(() => {});
    if (testUserId)   await admin.del(`/api/admin/users/${testUserId}`).catch(() => {});
    await admin.logout();
  }

  return results;
}
```

---

#### `security-probe/runner.ts` — full file, Commit 6 state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';
import { probeDeps }     from './probes/deps.js';
import { probeAuth }     from './probes/auth.js';
import { probeWebSocket } from './probes/websocket.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;
  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity, byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  findings.push(...await probeDeps(config));

  findings.push(...await probeAuth(config));
  findings.push(...await probeWebSocket(config));

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- WS row in summary with 8 tests
- WS-001 shows `pass`
- WS-003/004/005 evidence shows `Server alive`
- No orphaned documents or users remain

---

#### GitHub Actions test cases
- Mock WS upgrade/reject/close paths for all WebSocket-* findings.
- Verify crash-check health probe and teardown of created docs/users.

### Commit 7 — Input Sanitization Probe

**Goal:** Payload matrix across write endpoints. After analysis completes, ask for confirmation before deleting probe-created user/test data in interactive runs.

---

#### `security-probe/probes/input.ts` — new file

```typescript
import * as readline from 'node:readline/promises';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { createHttpClient } from '../http-client.js';

const PAYLOADS = [
  { id: 'xss-script',     type: 'xss-stored',     value: '<script>alert(1)</script>' },
  { id: 'xss-img',        type: 'xss-stored',     value: '<img src=x onerror=alert(document.cookie)>' },
  { id: 'xss-svg',        type: 'xss-reflected',  value: '"><svg onload=alert(1)>' },
  { id: 'sqli-or',        type: 'sqli',           value: "' OR 1=1--" },
  { id: 'sqli-drop',      type: 'sqli',           value: "'; DROP TABLE documents;--" },
  { id: 'sqli-union',     type: 'sqli',           value: "1 UNION SELECT username,password FROM users--" },
  { id: 'overflow-100k',  type: 'overflow',       value: 'A'.repeat(100_000) },
  { id: 'overflow-1m',    type: 'overflow',       value: 'A'.repeat(1_000_000) },
  { id: 'null-byte',      type: 'null-byte',      value: 'title\x00injected' },
  { id: 'path-traversal', type: 'path-traversal', value: '../../etc/passwd' },
] as const;

const ENDPOINTS = [
  { index: 1, path: '/api/documents', field: 'title', body: (v: string) => ({ title: v, document_type: 'wiki' }), getPath: (id: string) => `/api/documents/${id}` },
  { index: 2, path: '/api/issues',    field: 'title', body: (v: string) => ({ title: v }),                        getPath: (id: string) => `/api/issues/${id}` },
  { index: 3, path: '/api/projects',  field: 'name',  body: (v: string) => ({ name: v }),                         getPath: (id: string) => `/api/projects/${id}` },
];

const SQL_PATTERNS  = ['syntax error', ' sql', 'pg error', 'column', 'relation', 'ERROR:', 'invalid input'];
const LEAK_PATTERNS = ['at Object.', 'at Module.', '/app/', '/home/', 'C:\\'];

function isVulnerable(type: string, value: string, status: number, body: string): boolean {
  if (type === 'xss-stored' || type === 'xss-reflected')
    return body.includes(value);
  if (type === 'sqli')
    return status === 500 || SQL_PATTERNS.some(p => body.toLowerCase().includes(p.toLowerCase()));
  if (type === 'overflow')
    return status === 500;
  // null-byte, path-traversal
  return status === 500 || LEAK_PATTERNS.some(p => body.includes(p));
}

export async function probeInput(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];
  const client = createHttpClient(config);
  // Bootstrap login credentials are auto-registered and generated at runtime.

  const created: Array<{ deletePath: string }> = [];

  try {
    for (const ep of ENDPOINTS) {
      for (const payload of PAYLOADS) {
        const id = `INP-${ep.index}-${payload.id}`;
        try {
          const res    = await client.post(ep.path, ep.body(payload.value));
          const status = res.status;
          let body     = await res.text().catch(() => '');
          let checkBody = body;

          // For stored XSS: retrieve the resource and check the stored value
          if (payload.type === 'xss-stored' && status === 201) {
            let createdId: string | null = null;
            try { createdId = (JSON.parse(body) as { data?: { id?: string } })?.data?.id ?? null; } catch { /* ignore */ }
            if (createdId) {
              created.push({ deletePath: ep.getPath(createdId) });
              const getRes = await client.get(ep.getPath(createdId));
              checkBody = await getRes.text().catch(() => '');
            }
          }

          const vulnerable = isVulnerable(payload.type, payload.value, status, checkBody);

          results.push({
            id, category: 'input',
            title: `${payload.type} on ${ep.path} (${ep.field})`,
            severity: payload.type === 'sqli' ? 'critical' : payload.type.startsWith('xss') ? 'high' : 'low',
            status: vulnerable ? 'vulnerable' : 'pass',
            description: `Payload type "${payload.type}" submitted to POST ${ep.path} field "${ep.field}".`,
            reproduction: `1. Login using bootstrap probe account\n2. POST ${ep.path} with ${ep.field}: "${payload.value.slice(0, 60)}"\n3. ${payload.type === 'xss-stored' ? 'GET resource and inspect response' : 'Inspect response status and body'}`,
            evidence: {
              request:  `POST ${ep.path}\n${JSON.stringify(ep.body(payload.value.slice(0, 80)), null, 2)}`,
              response: `HTTP ${status}\n${checkBody.slice(0, 400)}`,
              expected: 'Payload rejected or escaped',
              actual:   vulnerable ? 'Payload found unescaped or server returned 500' : `HTTP ${status} — clean`,
            },
            remediation: payload.type.startsWith('xss')
              ? 'Escape all user input in API responses. Use parameterised queries.'
              : payload.type === 'sqli'
              ? 'Use parameterised queries. Never interpolate user input into SQL.'
              : 'Add input length limits and reject null bytes / path traversal sequences.',
          });
        } catch (err: unknown) {
          results.push({
            id, category: 'input',
            title: `Input probe error: ${payload.type} on ${ep.path}`,
            severity: 'info', status: 'inconclusive',
            description: 'Probe request failed.',
            reproduction: `POST ${ep.path} with ${payload.type} payload`,
            evidence: { expected: 'HTTP response', actual: err instanceof Error ? err.message : String(err) },
            remediation: 'Check connectivity and retry.',
          });
        }
      }
    }
  } finally {
    await client.logout();
  }

  // Cleanup prompt
  if (created.length > 0) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\nInput probe created ${created.length} test resources. Delete them now? [y/N] `);
      rl.close();
      if (answer.trim().toLowerCase() === 'y') {
        const c = createHttpClient(config);
        await c.login(bootstrapCreds.email, bootstrapCreds.password);
        for (const r of created) await c.del(r.deletePath).catch(() => {});
        await c.logout();
        console.log('Test resources deleted.');
      } else {
        console.log('Skipped. Delete manually:', created.map(r => r.deletePath).join(', '));
      }
    } else {
      console.warn(`\n[WARNING] ${created.length} test resources not cleaned up:`);
      created.forEach(r => console.warn(' ', r.deletePath));
    }
  }

  return results;
}
```

---

#### `security-probe/runner.ts` — full file, Commit 7 state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';
import { probeDeps }      from './probes/deps.js';
import { probeAuth }      from './probes/auth.js';
import { probeWebSocket } from './probes/websocket.js';
import { probeInput }     from './probes/input.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;
  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity, byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  findings.push(...await probeDeps(config));

  findings.push(...await probeAuth(config));
  findings.push(...await probeWebSocket(config));
  findings.push(...await probeInput(config));

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- INP row with 30 tests (10 payloads × 3 endpoints)
- Cleanup confirmation prompts appear for probe-created test data.
- In interactive runs: user can confirm or skip deletion.
- In non-interactive runs (CI): cleanup proceeds automatically to avoid blocking.

---

#### GitHub Actions test cases
- Mock payload matrix across endpoints and assert deterministic finding IDs.
- Test non-interactive cleanup behavior and non-TTY fallback warning.
- Verify interactive confirmation prompt logic is present for cleanup flows.

### Commit 8 — Manual Review: CORS/CSP and Secrets

**Goal:** Two header-inspection modules. No auth required.

---

#### `security-probe/manual/cors-csp.ts` — new file

```typescript
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

export async function checkCorsCsp(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  // CORS-001: arbitrary origin reflection
  try {
    const res = await fetch(`${config.target}/api/documents`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' },
      signal: AbortSignal.timeout(config.timeout),
    });
    const acao = res.headers.get('access-control-allow-origin') ?? '';
    const acac = res.headers.get('access-control-allow-credentials') ?? '';
    const vulnerable = acao === 'https://evil.example.com'
      || (acao === '*' && acac.toLowerCase() === 'true');
    results.push({
      id: 'CORS-001', category: 'cors-csp',
      title: 'CORS reflects arbitrary origin',
      severity: 'high', status: vulnerable ? 'vulnerable' : 'pass',
      description: 'The API should not reflect arbitrary origins in Access-Control-Allow-Origin.',
      reproduction: `OPTIONS ${config.target}/api/documents with Origin: https://evil.example.com`,
      evidence: {
        request:  'OPTIONS /api/documents\nOrigin: https://evil.example.com',
        response: `Access-Control-Allow-Origin: ${acao}\nAccess-Control-Allow-Credentials: ${acac}`,
        expected: 'ACAO not set to arbitrary origin',
        actual:   acao || '(header absent)',
      },
      remediation: 'Set CORS_ORIGIN to a fixed allowed origin. Never reflect the request Origin header.',
    });
  } catch (err: unknown) {
    results.push({ id: 'CORS-001', category: 'cors-csp', title: 'CORS check error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // CSP checks
  try {
    const res = await fetch(`${config.target}/health`, { signal: AbortSignal.timeout(config.timeout) });
    const csp = res.headers.get('content-security-policy') ?? '';

    // CSP-001: header present
    results.push({
      id: 'CSP-001', category: 'cors-csp',
      title: 'Content-Security-Policy header missing',
      severity: 'high', status: csp ? 'pass' : 'vulnerable',
      description: 'All responses should include a Content-Security-Policy header.',
      reproduction: `GET ${config.target}/health — inspect response headers`,
      evidence: { expected: 'CSP header present', actual: csp || '(absent)' },
      remediation: 'Configure helmet contentSecurityPolicy.',
    });

    if (csp) {
      // Parse: "directive value; directive value" → map
      const directives = Object.fromEntries(
        csp.split(';').map(d => d.trim()).filter(Boolean).map(d => {
          const [name, ...rest] = d.split(/\s+/);
          return [name.toLowerCase(), rest.join(' ')];
        })
      );
      const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? '';

      // CSP-002: unsafe-inline in script-src
      results.push({
        id: 'CSP-002', category: 'cors-csp',
        title: "CSP script-src contains 'unsafe-inline'",
        severity: 'high', status: scriptSrc.includes("'unsafe-inline'") ? 'vulnerable' : 'pass',
        description: "'unsafe-inline' negates XSS protection.",
        reproduction: `GET ${config.target}/health — check Content-Security-Policy script-src`,
        evidence: { expected: "script-src without 'unsafe-inline'", actual: `script-src: ${scriptSrc || '(not set)'}` },
        remediation: "Remove 'unsafe-inline' from script-src. Use nonces.",
      });

      // CSP-003: unsafe-eval
      results.push({
        id: 'CSP-003', category: 'cors-csp',
        title: "CSP contains 'unsafe-eval'",
        severity: 'medium', status: csp.includes("'unsafe-eval'") ? 'vulnerable' : 'pass',
        description: "'unsafe-eval' allows eval() and similar.",
        reproduction: `GET ${config.target}/health — check CSP for 'unsafe-eval'`,
        evidence: { expected: "No 'unsafe-eval'", actual: csp.includes("'unsafe-eval'") ? "Found 'unsafe-eval'" : "Not found" },
        remediation: "Remove 'unsafe-eval'. Refactor eval() / new Function() usage.",
      });

      // CSP-004: frame-ancestors
      results.push({
        id: 'CSP-004', category: 'cors-csp',
        title: 'CSP missing frame-ancestors',
        severity: 'medium', status: 'frame-ancestors' in directives ? 'pass' : 'vulnerable',
        description: 'Without frame-ancestors the app can be embedded in iframes (clickjacking).',
        reproduction: `GET ${config.target}/health — check CSP for frame-ancestors`,
        evidence: { expected: "frame-ancestors 'none'", actual: directives['frame-ancestors'] ?? '(absent)' },
        remediation: "Add frame-ancestors 'none' to CSP.",
      });
    }
  } catch (err: unknown) {
    results.push({ id: 'CSP-ERR', category: 'cors-csp', title: 'CSP check error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  return results;
}
```

---

#### `security-probe/manual/secrets.ts` — new file

```typescript
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'DATABASE_URL',   re: /DATABASE_URL/i },
  { name: 'SESSION_SECRET', re: /SESSION_SECRET/i },
  { name: 'PRIVATE_KEY',    re: /PRIVATE_KEY/i },
  { name: 'AWS key',        re: /AKIA[A-Z0-9]{16}/ },
  { name: 'password field', re: /"password"\s*:/ },
];

function scan(body: string): string[] {
  return PATTERNS.filter(p => p.re.test(body)).map(p => p.name);
}

export async function checkSecrets(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  // SEC-001: /health leaks env vars
  try {
    const body = await fetch(`${config.target}/health`, { signal: AbortSignal.timeout(config.timeout) })
      .then(r => r.text());
    const found = scan(body);
    results.push({
      id: 'SEC-001', category: 'secrets',
      title: '/health endpoint leaks secrets',
      severity: 'critical', status: found.length > 0 ? 'vulnerable' : 'pass',
      description: '/health should not expose secrets or database URLs.',
      reproduction: `GET ${config.target}/health — check body for secret patterns`,
      evidence: { expected: 'No secret patterns', actual: found.length > 0 ? `Found: ${found.join(', ')}` : 'Clean' },
      remediation: 'Return only { status: "ok" } from /health.',
    });
  } catch (err: unknown) {
    results.push({ id: 'SEC-001', category: 'secrets', title: 'SEC-001 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // SEC-002: error response leaks secrets
  try {
    const body = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@probe.local', password: 'wrong' }),
      signal: AbortSignal.timeout(config.timeout),
    }).then(r => r.text());
    const found = scan(body);
    results.push({
      id: 'SEC-002', category: 'secrets',
      title: 'Error response leaks secrets',
      severity: 'high', status: found.length > 0 ? 'vulnerable' : 'pass',
      description: 'Login error responses must not contain secret variable names.',
      reproduction: `POST ${config.target}/api/auth/login with invalid credentials`,
      evidence: { expected: 'Clean error response', actual: found.length > 0 ? `Found: ${found.join(', ')}` : 'Clean' },
      remediation: 'Return a generic error message from all auth endpoints.',
    });
  } catch (err: unknown) {
    results.push({ id: 'SEC-002', category: 'secrets', title: 'SEC-002 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // SEC-003: NODE_ENV in response
  try {
    const body = await fetch(`${config.target}/health`, { signal: AbortSignal.timeout(config.timeout) })
      .then(r => r.text());
    const exposed = /"NODE_ENV"/.test(body) || /"env"/.test(body);
    results.push({
      id: 'SEC-003', category: 'secrets',
      title: 'NODE_ENV exposed in API response',
      severity: 'low', status: exposed ? 'vulnerable' : 'pass',
      description: 'NODE_ENV should not appear as a JSON key in API responses.',
      reproduction: `GET ${config.target}/health — check for "NODE_ENV" or "env" key`,
      evidence: { expected: 'No NODE_ENV key', actual: exposed ? 'Found "NODE_ENV" or "env"' : 'Not found' },
      remediation: 'Remove NODE_ENV from /health response.',
    });
  } catch { /* covered by SEC-001 */ }

  return results;
}
```

---

#### `security-probe/runner.ts` — full file, Commit 8 state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';
import { probeDeps }      from './probes/deps.js';
import { probeAuth }      from './probes/auth.js';
import { probeWebSocket } from './probes/websocket.js';
import { probeInput }     from './probes/input.js';
import { checkCorsCsp }   from './manual/cors-csp.js';
import { checkSecrets }   from './manual/secrets.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;
  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity, byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  findings.push(...await probeDeps(config));

  findings.push(...await probeAuth(config));
  findings.push(...await probeWebSocket(config));
  findings.push(...await probeInput(config));

  findings.push(...await checkCorsCsp(config));
  findings.push(...await checkSecrets(config));

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- `cors-csp` and `secrets` rows in summary
- CSP-002 shows `vulnerable`
- SEC-001, SEC-002, SEC-003 show `pass`

---

#### GitHub Actions test cases
- Mock CORS/CSP headers and secret-leak bodies; assert CORS-*, CSP-*, SEC-* results.
- Verify findings are wired into summary category counts.

### Commit 9 — Manual Review: Rate Limiting and Error Verbosity

**Goal:** Final two modules. Tool complete.

---

#### `security-probe/manual/rate-limit.ts` — new file

```typescript
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

export async function checkRateLimit(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  // RL-001: general API rate limit — 120 sequential unauthenticated GETs
  try {
    let firstLimit = -1;
    for (let i = 1; i <= 120; i++) {
      const res = await fetch(`${config.target}/api/documents`, { signal: AbortSignal.timeout(config.timeout) });
      if (res.status === 429 && firstLimit === -1) { firstLimit = i; break; }
    }
    results.push({
      id: 'RL-001', category: 'rate-limiting',
      title: 'General API endpoint not rate-limited',
      severity: 'medium', status: firstLimit !== -1 ? 'pass' : 'vulnerable',
      description: 'GET /api/documents should return 429 within 120 rapid requests.',
      reproduction: 'Send 120 sequential unauthenticated GET /api/documents requests.',
      evidence: {
        expected: 'HTTP 429 before request 110',
        actual: firstLimit === -1 ? 'No 429 after 120 requests' : `First 429 at request ${firstLimit}`,
      },
      remediation: 'Apply express-rate-limit to all API routes, not just /api/auth/login.',
    });
  } catch (err: unknown) {
    results.push({ id: 'RL-001', category: 'rate-limiting', title: 'RL-001 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // RL-002: login rate limit — 8 sequential failed logins
  try {
    let firstLimit = -1;
    for (let i = 1; i <= 8; i++) {
      const res = await fetch(`${config.target}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'probe-rl@probe.local', password: 'wrong' }),
        signal: AbortSignal.timeout(config.timeout),
      });
      if (res.status === 429 && firstLimit === -1) { firstLimit = i; break; }
    }
    results.push({
      id: 'RL-002', category: 'rate-limiting',
      title: 'Login endpoint not rate-limited',
      severity: 'high', status: firstLimit !== -1 ? 'pass' : 'vulnerable',
      description: 'POST /api/auth/login should return 429 by the 6th failed attempt.',
      reproduction: 'Send 8 sequential POST /api/auth/login with wrong credentials.',
      evidence: {
        expected: 'HTTP 429 by attempt 6',
        actual: firstLimit === -1 ? 'No 429 after 8 attempts' : `First 429 at attempt ${firstLimit}`,
      },
      remediation: 'Ensure login rate limiter threshold is ≤ 5 failed requests per 15 minutes.',
    });
  } catch (err: unknown) {
    results.push({ id: 'RL-002', category: 'rate-limiting', title: 'RL-002 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // RL-003: recovery (informational)
  try {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe-rl@probe.local', password: 'wrong' }),
      signal: AbortSignal.timeout(config.timeout),
    });
    results.push({
      id: 'RL-003', category: 'rate-limiting',
      title: 'Rate limit window recovery',
      severity: 'info', status: 'inconclusive',
      description: 'After 5 seconds, records whether the rate limit window has reset.',
      reproduction: 'Trigger login rate limit, wait 5 seconds, send one more request.',
      evidence: { expected: 'Depends on window duration', actual: `HTTP ${res.status} after 5s wait` },
      remediation: 'Informational only.',
    });
  } catch { /* ignore */ }

  return results;
}
```

---

#### `security-probe/manual/error-verbosity.ts` — new file

```typescript
import type { Config } from '../config.js';
import type { Finding } from '../types.js';

const LEAK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'stack frame',  re: /at Object\.|at Module\.|at async / },
  { name: 'file path',    re: /\/app\/|\/home\/|C:\\\\/ },
  { name: 'SQL keyword',  re: /\bSELECT\b|\bFROM\b|\bWHERE\b/ },
];

function detectLeak(body: string): string[] {
  return LEAK_PATTERNS.filter(p => p.re.test(body)).map(p => p.name);
}

export async function checkErrorVerbosity(config: Config): Promise<Finding[]> {
  const results: Finding[] = [];

  // ERR-001: malformed JSON
  try {
    const res  = await fetch(`${config.target}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
      signal: AbortSignal.timeout(config.timeout),
    });
    const body   = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-001', category: 'error-verbosity',
      title: 'Malformed JSON triggers verbose error',
      severity: 'medium', status: leaked.length > 0 ? 'vulnerable' : 'pass',
      description: 'A malformed JSON body should produce a clean 400, not a stack trace.',
      reproduction: `POST ${config.target}/api/auth/login\nContent-Type: application/json\n\nthis is not json`,
      evidence: {
        request:  'POST /api/auth/login\nContent-Type: application/json\n\nthis is not json',
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'Clean 400 with no internal details',
        actual:   leaked.length > 0 ? `Leaked: ${leaked.join(', ')}` : 'No leakage',
      },
      remediation: 'Add a global Express error handler that sanitises all 4xx/5xx responses.',
    });
  } catch (err: unknown) {
    results.push({ id: 'ERR-001', category: 'error-verbosity', title: 'ERR-001 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // ERR-002: 404 internal paths
  try {
    const res  = await fetch(`${config.target}/api/nonexistent-route-probe-12345`, { signal: AbortSignal.timeout(config.timeout) });
    const body   = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-002', category: 'error-verbosity',
      title: '404 response leaks internal paths',
      severity: 'low', status: leaked.length > 0 ? 'vulnerable' : 'pass',
      description: 'A 404 for an unknown route should not reveal file paths or stack traces.',
      reproduction: `GET ${config.target}/api/nonexistent-route-probe-12345`,
      evidence: {
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'Clean 404',
        actual:   leaked.length > 0 ? `Leaked: ${leaked.join(', ')}` : 'No leakage',
      },
      remediation: 'Ensure the Express 404 handler returns a generic message.',
    });
  } catch (err: unknown) {
    results.push({ id: 'ERR-002', category: 'error-verbosity', title: 'ERR-002 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  // ERR-003: empty unauthenticated POST
  try {
    const res  = await fetch(`${config.target}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(config.timeout),
    });
    const body   = await res.text();
    const leaked = detectLeak(body);
    results.push({
      id: 'ERR-003', category: 'error-verbosity',
      title: 'Unauthenticated empty POST returns 500 or leaks internals',
      severity: 'medium', status: (res.status >= 500 || leaked.length > 0) ? 'vulnerable' : 'pass',
      description: 'POST /api/documents with no auth and empty body should return 401, not 500.',
      reproduction: `POST ${config.target}/api/documents\nContent-Type: application/json\n\n{}`,
      evidence: {
        response: `HTTP ${res.status}\n${body.slice(0, 500)}`,
        expected: 'HTTP 401, no stack trace',
        actual:   res.status >= 500 ? `HTTP ${res.status}` : leaked.length > 0 ? `Leaked: ${leaked.join(', ')}` : `HTTP ${res.status} — clean`,
      },
      remediation: 'Ensure authMiddleware runs before body validation.',
    });
  } catch (err: unknown) {
    results.push({ id: 'ERR-003', category: 'error-verbosity', title: 'ERR-003 error', severity: 'info', status: 'inconclusive', description: '', reproduction: '', evidence: { expected: '', actual: err instanceof Error ? err.message : String(err) }, remediation: '' });
  }

  return results;
}
```

---

#### `security-probe/runner.ts` — full file, Commit 9 / final state

```typescript
import type { Config } from './config.js';
import type { Finding, Report, Severity, Category } from './types.js';
import { probeDeps }          from './probes/deps.js';
import { probeAuth }          from './probes/auth.js';
import { probeWebSocket }     from './probes/websocket.js';
import { probeInput }         from './probes/input.js';
import { checkCorsCsp }       from './manual/cors-csp.js';
import { checkSecrets }       from './manual/secrets.js';
import { checkRateLimit }     from './manual/rate-limit.js';
import { checkErrorVerbosity } from './manual/error-verbosity.js';

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES: Category[] = [
  'auth', 'websocket', 'input', 'dependency',
  'cors-csp', 'secrets', 'rate-limiting', 'error-verbosity',
];

export function buildSummary(findings: Finding[]): Report['summary'] {
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length])
  ) as Record<Severity, number>;
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, findings.filter(f => f.category === c).length])
  ) as Partial<Record<Category, number>>;
  return {
    total:        findings.length,
    vulnerable:   findings.filter(f => f.status === 'vulnerable').length,
    passed:       findings.filter(f => f.status === 'pass').length,
    inconclusive: findings.filter(f => f.status === 'inconclusive').length,
    bySeverity, byCategory,
  };
}

export async function run(config: Config): Promise<Report> {
  const findings: Finding[] = [];

  findings.push(...await probeDeps(config));

  findings.push(...await probeAuth(config));
  findings.push(...await probeWebSocket(config));
  findings.push(...await probeInput(config));

  findings.push(...await checkCorsCsp(config));
  findings.push(...await checkSecrets(config));
  findings.push(...await checkRateLimit(config));
  findings.push(...await checkErrorVerbosity(config));

  return {
    generated: new Date().toISOString(),
    target:    config.target,
    summary:   buildSummary(findings),
    findings,
  };
}
```

---

#### User verification steps

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

Expected:
- All 8 categories in summary table
- `security-probe/reports/security-probe-report.md` has no `Not yet tested` entries
- JSON report parses successfully
- Exit code 0
#### GitHub Actions test cases
- Mock rate-limit and error-verbosity endpoints to cover all RL-*/ERR-* findings.
- Add end-to-end mocked CLI smoke to assert valid JSON and full markdown sections.
