# Shipshape Security Probe — PLAN.md

**Spec source:** Category 8 — Security Audit  
**Date:** 2026-05-21  
**Author:** Dhairya Surana

---

## 1. What We're Building

A **TypeScript CLI security probe tool** (`security-probe/`) that actively tests the live Ship application across four attack surfaces and produces a structured JSON + Markdown report.

The tool targets a **deployed instance** of Ship (production or shadow). It takes a single target URL and derives everything it needs from there.

The deliverable is a globally installed command:

```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

**One-time setup** (from the repo root):
```bash
npm install -g ./security-probe
```

---

## 2. Prototype vs Final Tool

Development happens in two stages. The final tool grows directly from the prototype — no throwaway code.

### Prototype

**Goal:** Get the tool running end-to-end against the deployed app as fast as possible.

**Scope:** Dependency vulnerabilities only (`probes/deps.ts`). This surface is self-contained (shells out to `pnpm audit --json`, no auth required, no live HTTP probing) which makes it the fastest path to a working, reportable tool.

**Done when:** `ship-security-probe <url>` runs, finds real CVEs, and produces a valid `security-probe-report.json` and `security-probe-report.md`.

### Final Tool

**Goal:** Full coverage of all four attack surfaces and all four manual review checks.

**Scope:** Adds auth & session, WebSocket validation, input sanitization, and the manual review modules on top of the working prototype scaffold.

**Done when:** All eight probe/review modules run and the report covers every metric in the spec's audit deliverable table.

---

## 3. Codebase Context

Ship is a monorepo (pnpm workspaces: `api/`, `web/`, `shared/`). Key security-relevant facts discovered during analysis:

| Surface | Current State |
|---------|--------------|
| Auth | Session cookies (HttpOnly, SameSite=strict, 15min inactivity / 12hr absolute) + API Bearer tokens |
| WebSocket | `/collaboration/{type}:{id}` via `y-websocket`; 30 conn/min + 50 msg/sec rate limiting |
| CORS | Single origin from `CORS_ORIGIN` env var, credentials enabled |
| CSP | Helmet with `'unsafe-inline'` in `scriptSrc` and `styleSrc` |
| Rate limiting | Login: 5 req/15min; API: 100 req/min (prod); WS: per-connection limits |
| Error handling | Structured `{ success, error: { code, message } }` — no global catch-all confirmed |
| Secrets | AWS SSM Parameter Store in prod; `.env.local` in dev |
| CSRF | `csrf-sync` package; skipped for Bearer token auth |

These facts inform which tests will likely find real findings vs. pass cleanly.

---

## 4. Architecture

```
security-probe/
├── index.ts              # CLI entry point (arg parsing, orchestration)
├── config.ts             # TargetConfig type + env/arg resolution
├── types.ts              # Finding, Severity, Category, Report types
├── runner.ts             # Runs all probes, collects findings
├── http-client.ts        # Thin fetch wrapper (cookie jar, auth headers)
│
├── probes/
│   ├── auth.ts           # Attack surface 1: Auth & session handling
│   ├── websocket.ts      # Attack surface 2: WebSocket validation
│   ├── input.ts          # Attack surface 3: Input sanitization
│   └── deps.ts           # Attack surface 4: npm audit parsing
│
├── manual/
│   ├── cors-csp.ts       # CORS origin + CSP header inspection
│   ├── secrets.ts        # Bundle/log secret exposure checks
│   ├── rate-limit.ts     # Rate limiting coverage check
│   └── error-verbosity.ts # Stack trace / SQL leakage check
│
└── reporter/
    ├── json.ts           # Writes report.json
    └── markdown.ts       # Writes report.md (human-readable summary)
```

### Data Flow

```
CLI args
  │
  ▼
config.ts ──────────────────────────────────┐
  │                                          │
  ▼                                          │
runner.ts ◄── http-client.ts (shared)        │
  │                                          │
  ├── probes/auth.ts ──────► Finding[]       │
  ├── probes/websocket.ts ──► Finding[]      │
  ├── probes/input.ts ──────► Finding[]      │
  ├── probes/deps.ts ───────► Finding[]      │
  ├── manual/cors-csp.ts ───► Finding[]      │
  ├── manual/secrets.ts ────► Finding[]      │
  ├── manual/rate-limit.ts ─► Finding[]      │
  └── manual/error-verbosity.ts ► Finding[]  │
            │                                │
            ▼                                │
        Report { summary, findings }  ◄──────┘
            │
            ├── reporter/json.ts  → security-probe-report.json
            └── reporter/markdown.ts → security-probe-report.md
                        │
                        └── stdout: summary table
```

---

## 5. Core Type System

```typescript
// types.ts

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Category = 'auth' | 'websocket' | 'input' | 'dependency' | 'cors-csp' | 'secrets' | 'rate-limiting' | 'error-verbosity';
type Status = 'vulnerable' | 'pass' | 'inconclusive';

interface Finding {
  id: string;                   // e.g. "Authentication-001"
  category: Category;
  title: string;
  severity: Severity;
  status: Status;
  description: string;
  reproduction: string;         // Step-by-step to reproduce
  evidence: {
    request?: string;           // HTTP request sent
    response?: string;          // HTTP response received
    expected: string;           // What secure behavior looks like
    actual: string;             // What was observed
  };
  remediation: string;
  cve?: string;                 // For dependency findings
  affectedFeature?: string;     // For dependency findings
}

interface Report {
  generated: string;            // ISO 8601, e.g. "2026-05-21T14:30:00.000Z"
  target: string;               // API base URL
  appVersion?: string;          // From /health endpoint
  summary: {
    total: number;
    vulnerable: number;
    passed: number;
    bySeverity: Record<Severity, number>;
    byCategory: Record<Category, number>;
  };
  findings: Finding[];
}
```

---

## 6. Probe Modules — Detailed Design

### 6.1 Auth & Session (`probes/auth.ts`)

Each test sends HTTP requests via the shared cookie-jar client and evaluates the response.

| Test ID | What It Tests | Pass Condition |
|---------|--------------|----------------|
| Authentication-001 | Unauthenticated access to protected route | 401 returned |
| Authentication-002 | Unauthenticated access to admin route | 401 or 403 returned |
| Authentication-003 | Session cookie flags (HttpOnly, Secure, SameSite) | All three present in prod |
| Authentication-004 | Privilege escalation: regular user accessing admin endpoint | 403 returned |
| Authentication-005 | CSRF token absent on state-changing POST | 403 or 401 returned |
| Authentication-006 | API token accepted without CSRF token | 200 (CSRF correctly skipped for Bearer) |
| Authentication-007 | Login brute force: >5 failed logins within 15 min | 429 on 6th attempt |
| Authentication-008 | Session still valid after reported logout | 401 after logout |
| Authentication-009 | Weak/predictable session token entropy check | Token not sequential or short |

**Implementation note:** The probe logs in via `POST /api/auth/login` using `--admin-email` / `--admin-password`, then auto-creates a member test user for privilege and cross-user checks. The member user is deleted in teardown (`try/finally`) even if tests fail. For auth/WebSocket tests, admin credentials are required; the probe fails fast with a clear error if they are missing.

### 6.2 WebSocket Validation (`probes/websocket.ts`)

Uses the `ws` package (already a dependency) to connect and send crafted messages.

| Test ID | What It Tests | Pass Condition |
|---------|--------------|----------------|
| WebSocket-001 | Connect without auth cookies | Connection rejected (HTTP 401 before upgrade) |
| WebSocket-002 | Connect to non-existent document | Rejected or returns error frame |
| WebSocket-003 | Oversized message (11MB binary) | Connection closed gracefully, server survives |
| WebSocket-004 | Invalid Yjs protocol message (random bytes) | Server ignores or closes; does not crash |
| WebSocket-005 | Message type outside 0–3 range (e.g., type=99) | Ignored or rejected cleanly |
| WebSocket-006 | Connection flood: 35 connections from same IP in 1 min | 31st+ connection returns 429 |
| WebSocket-007 | Message flood: >50 messages/sec on one connection | Connection closed after violations accumulate |
| WebSocket-008 | Connect as user-A to a private document owned by user-B | HTTP 403 on upgrade |

**Implementation note:** Each WS test verifies the server still responds to `/health` after the attack to confirm no crash.

### 6.3 Input Sanitization (`probes/input.ts`)

Tests all user-facing write endpoints. Builds a matrix of payloads × endpoints.

**Endpoints tested:** document title, document content, issue title, project name, workspace name, user display name, feedback text, search/filter query params.

**Payload library:**

```
XSS (reflected):  <script>alert(1)</script>
XSS (stored):     <img src=x onerror=alert(document.cookie)>
XSS (attribute):  "><svg onload=alert(1)>
SQL injection:    ' OR 1=1--
SQL injection:    '; DROP TABLE documents;--
SQL injection:    1 UNION SELECT username,password FROM users--
Overflow:         "A".repeat(100_000)
Overflow:         "A".repeat(1_000_000)
Null bytes:       "title\x00injected"
Path traversal:   "../../etc/passwd"
```

| Test ID | Payload Type | Pass Condition |
|---------|-------------|----------------|
| Input-001..N | XSS stored | Payload not executed when retrieved (escaped in response) |
| Input-N..M | XSS reflected | Payload escaped in error response |
| Input-M..P | SQL injection | No DB error leaked; data unchanged |
| Input-P..Q | Long input | 400 returned or truncated cleanly; no 500 |
| Input-Q..R | Null bytes | Rejected or sanitized; no 500 |

**Detection method:** After storing a payload, retrieve the resource and check whether the raw payload appears unescaped in the JSON response body.

**Cleanup behavior:** Input probes create test resources. In interactive mode, the tool prompts before deleting them. In non-interactive mode (or when `--yes` is set), cleanup runs automatically and any cleanup failures are recorded in findings/output.

### 6.4 Dependency Vulnerabilities (`probes/deps.ts`)

```typescript
// Runs: pnpm audit --json (from repo root)
// Parses: advisories with severity = 'high' | 'critical'
// Maps: vulnerable package → which app features use it
```

Feature mapping is done via static import analysis: for each vulnerable package, grep the codebase for `import ... from 'package-name'` and identify which route/module files import it, then map to a human-readable feature name.

Output includes CVE ID, CVSS score, affected versions, fixed version, and the Ship feature that depends on the package.

---

## 7. Manual Review Modules

These modules perform automated checks for things classically done manually.

### 7.1 CORS & CSP (`manual/cors-csp.ts`)

- Send a preflight request with `Origin: https://evil.example.com` → verify no `Access-Control-Allow-Origin: *` or reflection of arbitrary origin
- Fetch any page and parse `Content-Security-Policy` header
- Flag: `'unsafe-inline'` in `script-src`, `'unsafe-eval'`, missing `frame-ancestors`, `connect-src` allowing `*`

### 7.2 Secrets Exposure (`manual/secrets.ts`)

- Check that `/health` does not expose environment variables or internal paths
- Check that API error responses do not contain `SESSION_SECRET`, `DATABASE_URL`, or AWS key patterns (`AKIA[A-Z0-9]{16}`)
- Check that `NODE_ENV` is not surfaced in any API response body

### 7.3 Rate Limiting (`manual/rate-limit.ts`)

- Send 150 rapid requests to `/api/documents` → verify 429 appears before 150
- Send 150 rapid requests to `/api/issues` → same
- Send 10 rapid login attempts → verify 429 on 6th
- Send 40 WebSocket connections from same IP in 60 seconds → verify 429

### 7.4 Error Verbosity (`manual/error-verbosity.ts`)

- Send a malformed JSON body to a POST endpoint → check 400 response for stack trace, file path, SQL
- Trigger a 500 by sending a structurally valid but DB-breaking payload → check for stack trace
- Request a non-existent route → check 404 body for internal paths
- Check that error `message` field never contains `at Object.` (stack frame indicator)

---

## 8. Reporter

### JSON Report (`reporter/json.ts`)

Everything is written to report files. Writes `security-probe-report.json` with the full `Report` type. Suitable for programmatic consumption and CI integration.

### Markdown Report (`reporter/markdown.ts`)

Writes `security-probe-report.md` with all findings regardless of status, including:
- Executive summary table (mirrors the spec's audit deliverable table)
- Finding details grouped by category, sorted by severity
- Reproduction steps as numbered lists
- Evidence as code blocks

### Stdout

After run, prints a compact summary table:

```
┌─────────────────────────────────────────────────────────────┐
│  Shipshape Security Probe — 2026-05-21T14:30:00Z            │
│  Target: http://localhost:3000                               │
├──────────────┬────────┬──────┬─────────────┬──────────────┤
│  Category    │ Tests  │ Vuln │ Inconclusive │ Top Severity │
├──────────────┼────────┼──────┼─────────────┼──────────────┤
│  Auth        │  9     │  ?   │  ?           │  ?           │
│  WebSocket   │  8     │  ?   │  ?           │  ?           │
│  Input       │  ~30   │  ?   │  ?           │  ?           │
│  Deps        │  1     │  ?   │  ?           │  ?           │
│  CORS/CSP    │  5     │  ?   │  ?           │  ?           │
│  Secrets     │  4     │  ?   │  ?           │  ?           │
│  Rate Limit  │  4     │  ?   │  ?           │  ?           │
│  Errors      │  4     │  ?   │  ?           │  ?           │
└──────────────┴────────┴──────┴─────────────┴──────────────┘
  Reports: security-probe-report.json, security-probe-report.md
```

---

## 9. Tech Stack Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript | Matches repo; shared types with the app |
| HTTP client | Native `fetch` (Node 18+) + `tough-cookie` | Cookie jar for session handling across requests |
| WebSocket client | `ws` package | Already in `api/package.json`; reuse |
| CLI arg parsing | `parseArgs` (Node built-in) | No new deps for simple flag parsing |
| Process runner | `child_process.execSync` | For `pnpm audit --json` |
| Runner | `tsx` (already dev dep) | Run TypeScript directly without compile step |

**One new runtime dependency:** `tough-cookie` for cookie jar support. All other packages are already installed.

---

## 10. Single-Command Invocation

`security-probe/` is its own npm package with a `bin` entry pointing to the TypeScript entrypoint and executed via `tsx`. Users install once and then use the command directly.

**One-time setup:**
```bash
npm install -g ./security-probe
```

**Usage:**
```bash
ship-security-probe https://ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com
```

**Repo auto-detection:** The tool walks up from `process.cwd()` looking for `pnpm-lock.yaml` to locate the repo root (needed for the dependency probe). If not found, it errors with a clear message and suggests using `--repo`.

Flags:

| Flag | Default | Description |
|------|---------|-------------|
| `<url>` | *(required, positional)* | Deployed API base URL |
| `--output` | `.` | Directory for report files |
| `--verbose` | false | Log each HTTP request/response |
| `--timeout` | `10000` | Per-request timeout in ms |
| `--repo` | auto-detected | Path to Ship repo root (for dependency probe) |
| `--admin-email` | *(required for auth/WS tests)* | Admin account email |
| `--admin-password` | *(required for auth/WS tests)* | Admin account password |
| `--yes` | false | Non-interactive mode: auto-approve probe cleanup prompts |

---

## 11. File Locations (Final Deliverables)

| File | Purpose |
|------|---------|
| `security-probe/` | The tool (source code) |
| `security-probe/README.md` | How to run the tool |
| `security-probe-report.json` | Machine-readable findings (generated at run time, gitignored) |
| `security-probe-report.md` | Human-readable audit report (generated at run time) |
| `PLAN.md` | This file |

---

## 12. Out of Scope

- Destructive attacks that would corrupt production data or cause downtime
- Social engineering / phishing vectors
- Infrastructure-level attacks (AWS, CloudFront) — requires separate cloud access
- Zero-day research — goal is to surface known vulnerability classes

---

## 13. Success Criteria

1. `ship-security-probe <url>` runs against the target instance and exits cleanly
2. `security-probe-report.json` and `security-probe-report.md` are generated and valid
3. `security-probe-report.md` fills the full audit deliverable table from the spec
4. Auth/WebSocket/input probes auto-create required test users/resources and perform teardown, with any cleanup failures explicitly reported
5. The tool works in both interactive and non-interactive modes (`--yes`)
