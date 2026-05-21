
# Category 1: Type Safety

## Methodology
Used an AST-based TypeScript scan for accuracy (instead of regex-only counting):
1. File inventory: `rg --files -g "*.ts" -g "*.tsx" -g "*.mts" -g "*.cts"` (excluding `node_modules`, `dist`, `build`, `.git`, `coverage`, `.next`, `out`), totaling 401 files.
2. Parse each file via TypeScript compiler API (`typescript.createSourceFile`).
3. Count by syntax node kind:
   - Explicit `any`: `SyntaxKind.AnyKeyword`
   - Type assertions: `SyntaxKind.AsExpression` + `SyntaxKind.TypeAssertionExpression`
   - Non-null assertions: `SyntaxKind.NonNullExpression`
4. Count suppressions via source-text scan for `@ts-ignore` and `@ts-expect-error`.
5. Break down counts by package (`api/`, `web/`, `shared/`) to locate concentration.
6. Derive top 5 violation-dense files by summing the four counts per file.
7. Verify strict mode by reading `tsconfig.json` files (`/tsconfig.json`, `/api/tsconfig.json`, `/web/tsconfig.json`, `/shared/tsconfig.json`).
8. Compute implicit-`any` diagnostics from TypeScript compiler output (`ts.getPreEmitDiagnostics`) and dedupe by `file:line:code` across workspace `tsconfig` programs.

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Explicit `any` types | 280 |
| Type assertions (`as` / `<T>expr`) | 719 |
| Total non-null assertions (`!`) | 348 |
| Total @ts-ignore / @ts-expect-error | 1 |
| Total implicit-`any` diagnostics (deduped) | 162 (`TS7006`: 159, `TS7031`: 2, `TS7053`: 1) |
| Package breakdown (`any` / `as` / `!` / suppressions) | `api`: 240 / 317 / 296 / 0; `web`: 33 / 372 / 33 / 1; `shared`: 0 / 2 / 0 / 0 |
| Implicit-`any` package breakdown | `api`: 0; `web`: 156; `shared`: 0; `other`: 6 |
| `strict` mode enabled? | Yes (`true`) |
| Strict mode error count (if disabled) | N/A |
| Top 5 violation-dense files | `api/src/routes/weeks.ts` (85), `api/src/__tests__/transformIssueLinks.test.ts` (66), `api/src/services/accountability.test.ts` (64), `api/src/__tests__/auth.test.ts` (63), `api/src/routes/projects.ts` (51) |

## Specific Weaknesses / Opportunities
1. High assertion volume (`as`: 719) indicates heavy use of manual type coercion; this can hide real shape mismatches at API, DB, and serialization boundaries.
2. Non-null assertion count is high (`!`: 348), with concentration in route handlers; this suggests nullable control flow is not being modeled explicitly and can produce runtime `undefined`/`null` failures.
3. `any` usage (`280`) is concentrated in tests and some route/service code; this weakens refactor safety and allows invalid mocks/fixtures to pass type checks.
4. Low suppression count (`@ts-ignore`/`@ts-expect-error`: 1) is a strength; direct compiler suppression is not broadly abused.
5. Violation density is concentrated in `api/src/routes/*` and API tests, making those files the highest-leverage cleanup targets.

## Severity/Impact Rankings
1. `as` assertions overuse (`719`) - High impact, High priority.
2. Non-null assertions (`348`) - High impact, High priority.
3. Explicit `any` (`280`) - Medium-High impact, Medium-High priority.
4. Hotspot concentration in API routes/tests - Medium impact, Medium priority (good targeting signal).
5. `@ts-ignore`/`@ts-expect-error` count (`1`) - Low risk, monitor only.
 

# Category 2: Bundle Size

## Methodology
Measured from a real production build artifact (not dev server output):
1. Built frontend with sourcemaps enabled using Vite production mode:
   - `corepack pnpm -C web exec vite build --sourcemap`
2. Read emitted files from `web/dist/assets` and computed:
   - Total production bundle size = sum of emitted `.js` + `.css` bytes
   - Largest chunk = max file size among emitted assets
   - Number of chunks = count of emitted `.js` and `.css` files
3. Estimated top dependency contributors by parsing `web/dist/assets/index-C2vAyoQ1.js.map`:
   - Aggregated `sourcesContent` byte length for each package path under `node_modules` (pnpm layout normalized)
4. Identified unused dependencies by static import graph scan:
   - Parsed all `web/src/**/*.{ts,tsx,js,jsx,mts,cts}` imports/exports/dynamic imports/require
   - Compared discovered package specifiers to `web/package.json` `dependencies`
5. Used rollup-plugin-visualizer to generate treemap artifact.

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total production bundle size | 2,329,568 bytes (2,263,056 JS + 66,512 CSS; ~2.22 MiB total) |
| Largest chunk | `assets/index-C2vAyoQ1.js` - 2,073,741 bytes (~1.98 MiB) |
| Number of chunks | 262 total (261 JS + 1 CSS) |
| Top 3 largest dependencies | `emoji-picker-react` (~398.4 KiB source-mapped), `highlight.js` (~376.4 KiB), `react-router` (~346.7 KiB) |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister`, `@uswds/uswds` |

### Treemap
Bundle treemap artifact (rollup-plugin-visualizer):
[category2-bundle-treemap.html](../../../audit-evidence/category2-bundle-treemap.html)

## Specific Weaknesses / Opportunities
1. Main bundle concentration is very high: one chunk (`index-C2vAyoQ1.js`) is ~89% of all JS output, indicating limited practical code-splitting impact on initial payload.
2. Heavy third-party libraries (`emoji-picker-react`, `highlight.js`, `react-router`) dominate mapped dependency size; these are prime candidates for route-level/lazy loading or lighter alternatives where feasible.
3. Emitted chunk count is high (262), but most chunks are tiny icon chunks; this adds request overhead while not significantly reducing the largest JS payload.
4. `@tanstack/query-sync-storage-persister` and `@uswds/uswds` appear unused in current source imports and should be validated for removal.
5. Vite warning confirms chunk-size threshold breach (>500 kB), reinforcing that current split strategy is not containing primary bundle growth.

## Severity/Impact Rankings
1. Oversized main chunk (`index-C2vAyoQ1.js` ~1.98 MiB) - High impact, High priority.
2. Heavy dependency footprint in critical bundle path - High impact, High priority.
3. Potentially unused dependencies - Medium impact, Medium priority.
4. Many micro-chunks with limited initial payload relief - Medium impact, Medium priority.

# Category 3: API Response Time

## Methodology
Measured directly against the local API with authenticated requests and percentile sampling:
1. Verified API availability: `GET /health` on `http://127.0.0.1:3000`.
2. Seeded dataset baseline (from `npx tsx seed-realistic.ts`) before measurement:
   - 30 users
   - 750 total documents
   - 180 issues
   - 16 sprints
3. Established authenticated session:
   - Fetched CSRF token from `GET /api/csrf-token`
   - Logged in with seeded test user via `POST /api/auth/login` using `x-csrf-token`
4. Benchmarked representative read endpoints:
   - `GET /api/auth/me`
   - `GET /api/documents`
   - `GET /api/issues`
   - `GET /api/projects`
   - `GET /api/weeks`
5. Sampling protocol per endpoint:
   - 5 warmup requests
   - 40 measured requests
   - Stopwatch-based latency capture per request in milliseconds
6. Computed P50, P95, and P99 using rank-based percentiles (ceil percentile rank over sorted samples).
7. Validated status consistency; all samples returned HTTP 200.

## Measurements

### 10 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 19.13 ms | 28.42 ms | 33.30 ms |
| `/api/documents` | 113.70 ms | 148.96 ms | 159.02 ms |
| `/api/issues` | 41.46 ms | 56.17 ms | 68.31 ms |
| `/api/projects` | 14.52 ms | 18.47 ms | 21.57 ms |
| `/api/weeks` | 14.19 ms | 18.07 ms | 20.48 ms |

### 25 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 35.82 ms | 49.60 ms | 52.95 ms |
| `/api/documents` | 285.91 ms | 326.62 ms | 348.19 ms |
| `/api/issues` | 119.87 ms | 160.49 ms | 179.84 ms |
| `/api/projects` | 49.32 ms | 59.50 ms | 63.26 ms |
| `/api/weeks` | 48.45 ms | 57.08 ms | 64.33 ms |

### 50 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 77.54 ms | 111.72 ms | 133.56 ms |
| `/api/documents` | 612.60 ms | 686.08 ms | 714.38 ms |
| `/api/issues` | 257.19 ms | 309.56 ms | 329.32 ms |
| `/api/projects` | 100.36 ms | 124.93 ms | 136.01 ms |
| `/api/weeks` | 79.85 ms | 98.63 ms | 110.50 ms |

## Specific Weaknesses / Opportunities
1. `GET /api/documents` is the clear primary bottleneck under concurrency, rising from P50 113.70 ms / P99 159.02 ms (10 connections) to P50 612.60 ms / P99 714.38 ms (50 connections).
2. `GET /api/issues` is the secondary scaling hotspot, increasing to P50 257.19 ms / P99 329.32 ms at 50 connections, with a consistently wider tail than auth/projects/weeks.
3. `GET /api/auth/me`, `GET /api/projects`, and `GET /api/weeks` remain comparatively lower-latency, but all show expected concurrency-induced degradation at 50 connections (for example, `/api/auth/me` P99 133.56 ms).
4. Reliability was strong in finalized runs: all measured requests returned HTTP 200 for each completed table (10, 25, and 50 simultaneous connections).
5. These are local-environment measurements and do not include production network RTT, proxy/CDN layers, or cloud database variance.

## Severity/Impact Rankings
1. `/api/documents` concurrent latency profile (highest median and tail across all load levels) - High impact, High priority.
2. `/api/issues` concurrent scaling/tail behavior (second-highest latency envelope) - Medium-High impact, Medium-High priority.
3. Auth/projects/weeks concurrency drift at 50 sessions (non-critical but measurable) - Medium impact, Medium priority.
4. Local-only benchmark scope (no production network/infrastructure effects) - Medium impact, Medium priority follow-up.

# Category 4: Database Query Efficiency

## Methodology
Used a two-layer approach: request-level SQL instrumentation + direct PostgreSQL plan inspection.
1. Request-level instrumentation in API runtime to capture:
   - total SQL queries executed per request
   - slowest query duration per request
   - repeated-query patterns as N+1 signal
2. Added local debug measurement endpoints (dev-only):
   - `POST /api/debug/query-audit/reset`
   - `GET /api/debug/query-audit/snapshot`
3. Authenticated with seeded account (`dev@ship.local`) and mapped required user flows to concrete endpoints:
   - Load main page -> `GET /api/dashboard/my-work`
   - View a document -> `GET /api/documents/:id`
   - List issues -> `GET /api/issues`
   - Load sprint board -> `GET /api/weeks/my-week`
   - Search content -> `GET /api/search/mentions?q=ship`
4. For each flow, executed: reset -> single request -> snapshot.
5. Ran `EXPLAIN (ANALYZE, BUFFERS)` on representative SQL for each flow with real seeded parameters from `ship_dev` (containerized PostgreSQL).
6. Exported index inventory from `pg_indexes` for `documents`, `document_associations`, `workspace_memberships`, and `users`; compared predicates against existing indexes to identify index gaps.
7. Marked N+1 as `Pass` when no repeated per-item query pattern was detected in the captured request.

## Measurements

| User Flow | Total Queries | Slowest Query (ms) | N+1 Detected? |
|-----------|---------------|-------------------|---------------|
| Load main page | 7 | 4.54 | No |
| View a document | 4 | 2.48 | No |
| List issues | 5 | 4.69 | No |
| Load sprint board | 5 | 3.19 | No |
| Search content | 5 | 2.09 | No |

`EXPLAIN ANALYZE` evidence (slow-query shape per flow):

| User Flow | Representative Query Plan Signal | Execution Time |
|-----------|-----------------------------------|----------------|
| Load main page (`/api/dashboard/my-work`) | `Bitmap Heap Scan on documents d` after `idx_documents_document_type`, then filter removes non-matching issue rows (`Rows Removed by Filter: 166`) | 2.450 ms |
| View a document (`/api/documents/:id`) | `Index Scan using documents_pkey` (point lookup) | 0.099 ms |
| List issues (`/api/issues`) | `Bitmap Heap Scan on documents d` + hash joins; full `users` scan is small (`30` rows) | 0.579 ms |
| Load sprint board (`/api/weeks/my-week`, populated sprint) | `Bitmap Heap Scan on documents s` via `document_type` index then filter on `(properties->>'sprint_number')::int` | 1.090 ms |
| Search content (`/api/search/mentions?q=ship`) | `Seq Scan on documents` for `title ILIKE '%ship%'` (`Rows Removed by Filter: 745`) | 1.469 ms |

Evidence artifacts:
- EXPLAIN output: [category4-explain-output.txt](../../../audit-evidence/category4-explain-output.txt)
- Index inventory: [category4-index-inventory.txt](../../../audit-evidence/category4-index-inventory.txt)

## Specific Weaknesses / Opportunities
1. Main-page issue retrieval is the heaviest measured path (`2.450 ms`), and plan evidence shows filtering work after broad `document_type='issue'` fetch; this suggests a composite/expression index opportunity around assignee/state/workspace filters.
2. Search mentions uses `Seq Scan on documents` for `title ILIKE '%ship%'`; this is explicit evidence of a text-search index gap for substring search (for example trigram-based indexing).
3. Sprint-board query filters by `(s.properties->>'sprint_number')::int` and currently scans sprint docs by type first; lack of an index on extracted `sprint_number` causes extra filter work.
4. No N+1 pattern was detected in sampled flows, which remains a strength.
5. Query-count baseline is still single-request per flow; concurrent database behavior is not covered in this pass.

## Severity/Impact Rankings
1. Missing text-search index support for `ILIKE '%...%'` in mentions flow (Seq Scan evidence) - High impact, High priority.
2. Main-page issue query filter selectivity/index-shape mismatch - Medium-High impact, High priority.
3. Missing expression index for sprint-number property filtering - Medium impact, Medium-High priority.
4. No N+1 detected in sampled flows - Low risk.
5. Lack of concurrent-load DB profiling in this pass - Medium risk for production-readiness confidence.


# Category 5: Test Coverage and Quality

## Methodology
Measured directly from runnable test suites and test inventory:
1. Flaky-test check by repeated execution (3 full passes):
   - Pass 1: `corepack pnpm -C api test` + `corepack pnpm -C web test`
   - Pass 2: `corepack pnpm -C api test` + `corepack pnpm -C web test`
   - Pass 3: `corepack pnpm -C api test` + `corepack pnpm -C web test`
   - API runs executed with Docker DB URL explicitly set: `postgres://ship:ship_dev_password@127.0.0.1:5433/ship_dev`
2. Captured from Vitest summaries per run:
   - Test files and test counts
   - Pass/fail/error outcomes
   - Runtime
3. Configured coverage tooling:
   - Installed `@vitest/coverage-v8@4.0.17` in both `api` and `web` to match `vitest@4.0.17`
   - Added V8 coverage config to `web/vitest.config.ts`
4. Ran coverage with JSON summaries:
   - API: `corepack pnpm -C api exec vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text`
   - Web: `corepack pnpm -C web exec vitest run --coverage --coverage.reportOnFailure=true --coverage.reporter=json-summary --coverage.reporter=text`
5. Identified critical uncovered flows by checking route test presence under `api/src/routes/*.test.ts` and comparing against high-impact route modules.
6. Stored evidence logs:
   - `docs/dhairya_docs/Audit-via-codex/category5-run{1,2,3}-api.txt`
   - `docs/dhairya_docs/Audit-via-codex/category5-run{1,2,3}-web.txt`
   - `docs/dhairya_docs/Audit-via-codex/category5-coverage-api.txt`
   - `docs/dhairya_docs/Audit-via-codex/category5-coverage-web.txt`

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total tests | 602 executed (API: 451, Web: 151) |
| Pass / Fail / Flaky | Stable functional failures: 13 web test failures in all 3 runs; intermittent infrastructure flake: API run 2 had 1 worker-fork crash (`27/28` files completed, `447/451` tests completed) while runs 1 and 3 were fully green (`451/451`) |
| Suite runtime | Run 1: 52.41s total (API 47.05s, Web 5.36s); Run 2: 51.77s total (API 46.46s, Web 5.31s); Run 3: 56.26s total (API 48.15s, Web 8.11s) |
| Critical flows with zero coverage| No API route test files detected for: AI analysis endpoints (`/api/ai/*`), dashboard endpoints (`/api/dashboard/*`), CAIA/PIV auth routes (`/api/auth/caia/*`, `/api/auth/piv/*`), weekly plans routes (`/api/weekly-plans/*`), admin credentials routes (`/api/admin/credentials/*`) |
| Code coverage % | API: statements 40.34%, branches 33.44%, functions 40.90%, lines 40.52%; Web: statements 27.63%, branches 19.38%, functions 25.60%, lines 28.53% |

## Specific Weaknesses / Opportunities
1. Web suite has persistent failures across all three runs (13 failing tests each run), concentrated in `document-tabs`, `DetailsExtension`, and `useSessionTimeout`; these are deterministic regressions, not flaky behavior.
2. API suite is largely stable (full pass in runs 1 and 3), but run 2 produced one vitest worker-fork crash (`[vitest-pool]: Worker forks emitted error`), indicating intermittent test-runner/environment instability.
3. Coverage is now measurable and shows substantial risk concentration: web branch coverage is low (19.38%), and API branch coverage is moderate (33.44%), indicating meaningful untested decision logic.
4. Several high-impact backend modules still lack dedicated route tests (AI analysis, dashboard, CAIA auth, weekly plans, admin credentials), creating blind spots in behavior validation.

## Severity/Impact Rankings
1. Persistent 13-test web failure set (3/3 runs) - High impact, High priority.
2. Low web branch coverage (19.38%) and modest API branch coverage (33.44%) - High impact, High priority.
3. Critical backend route modules without dedicated tests - Medium-High impact, Medium-High priority.
4. Intermittent API run instability (worker-fork crash in run 2 only) - Medium impact, Medium priority.

# Category 6: Runtime Error and Edge Case Handling

## Methodology
Used runtime edge-case execution plus server-log verification:
1. Malformed input tests (authenticated API):
   - Empty login payload (`email=''`, `password=''`)
   - Empty document title
   - Overlong title (`5000` chars)
   - Script/special-character title payload (`<script>...` and punctuation)
2. Concurrent same-field edit test:
   - Two authenticated sessions patched the same `documents.title` field concurrently on the same document.
3. Network degradation tests in browser (Playwright + CDP):
   - 3G-like throttling via `Network.emulateNetworkConditions`
   - Offline reload, then online recovery reload
   - Captured browser `console.error` and `pageerror`
4. Server-side log checks:
   - Collected recent API container logs during the test window.
5. Static reliability scan:
   - Checked for global Node handlers (`unhandledRejection`, `uncaughtException`)
   - Reviewed error boundary and error-path patterns.

Evidence artifacts:
- [category6-malformed-concurrency.json](../../../audit-evidence/category6-malformed-concurrency.json)
- [category6-3g-and-recovery.json](../../../audit-evidence/category6-3g-and-recovery.json)
- [category6-server-logs.txt](../../../audit-evidence/category6-server-logs.txt)

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Console error during normal usage | High error volume in browser run, dominated by CORS failures (`http://127.0.0.1:5173` origin vs API `CORS_ORIGIN=http://localhost:5173`) |
| Unhandled promise rejections (server) | No global `process.on('unhandledRejection')` or `process.on('uncaughtException')` handler detected |
| Network disconnect recovery (Pass / Partial / Fail) | Partial (offline produced browser error page; online reload recovered to login route) |
| Missing error boundaries (locations) | Local boundaries exist in `web/src/pages/App.tsx` and `web/src/components/Editor.tsx`; no clear app-wide boundary around all route trees and async data errors |
| Silent failures identified | Yes - setup/auth checks fail repeatedly in UI with fetch/CORS failures while remaining on login route; failures are noisy in console but weakly actionable in UX |

## Specific Weaknesses / Opportunities
1. CORS configuration mismatch (`127.0.0.1` web origin vs `localhost` API CORS allowlist) causes repeated auth/setup fetch failures, masking true runtime behavior and degrading resilience under degraded networks.
2. Malformed input validation is strong for empty/overlong titles (`400` with structured validation errors), but script-like title content is accepted as raw text at API layer; output encoding/sanitization guarantees should be verified end-to-end at render points.
3. Concurrent same-field update behavior is last-write-wins (both `200`, final read reflects second write), which avoids crashes but has overwrite risk without conflict cues/audit UX.
4. Disconnect recovery remains partial in this run: offline reload drops to browser error page; online recovers to login, not prior in-app context.
5. Server process still lacks global unhandled rejection/exception guards, leaving process-level crash handling dependent on surrounding infrastructure.

## Severity/Impact Rankings
1. CORS-origin mismatch causing broad runtime fetch failures - High impact, High priority.
2. Missing server global unhandled-rejection/uncaught-exception handling - High impact, High priority.
3. Concurrent same-field last-write-wins overwrite risk - Medium-High impact, Medium-High priority.
4. Partial disconnect recovery behavior (offline to browser error page) - Medium impact, Medium priority.
5. Scoped boundary coverage and weak user-facing remediation for repeated runtime failures - Medium impact, Medium priority.

# Category 7: Accessibility Compliance

## Methodology
Measured with authenticated full-route automation and redirect validation:
1. Logged in via UI (`dev@ship.local`) and verified authenticated session before scans.
2. Built a 17-route major-page inventory (including dynamic `/documents/:id`) and saved route manifest.
3. For each route, navigated in-session and recorded final URL (to detect auth redirects).
4. Ran Axe scans via Playwright (`@axe-core/playwright`) and saved full JSON per route.
5. Ran Lighthouse accessibility audits (v13.3.0) and saved full JSON per route.
6. Aggregated Lighthouse per-page scores, Axe severity totals, contrast failures, and ARIA/role-label findings.
7. Ran an NVDA screen-reader pass via Guidepup with capture enabled across the full 17-route inventory; collected `spokenPhraseLog`, `itemTextLog`, and keyboard focus traces per route.

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Lighthouse accessibility score (per page) | 17/17 routes scored `98` (`login`, `setup`, `my-week`, `dashboard`, `docs`, `issues`, `projects`, `programs`, `document`, `team-allocation`, `team-directory`, `team-status`, `team-reviews`, `team-org-chart`, `admin`, `settings`, `settings-conversions`) |
| Total Critical / Serious violations | 1 critical / 49 serious (Axe node-level totals across full route set) |
| Keyboard navigation completeness (Full / Partial / Broken) | Partial |
| Color contrast failures | 49 node-level `color-contrast` failures |
| Missing ARIA labels or roles (locations)| None detected by Axe in full-route scan |
| Screen-reader testing (NVDA/JAWS/Narrator) | Partial: NVDA + Guidepup run completed across 17/17 major routes with login success and per-route focus traces; speech logs captured but are mostly `blank`/noisy, so announcement-quality verification remains incomplete |


### Screen Reader


Evidence artifacts:
- [category7-screen-reader-evidence.json](../../../audit-evidence/category7-screen-reader-evidence.json)
- [category7-screen-reader-run.txt](../../../audit-evidence/category7-screen-reader-run.txt)
Status: Partial completion (coverage complete; announcement quality evidence incomplete).

Latest observed run summary (NVDA + Guidepup, `2026-05-20T22:32:28.675Z`):
- Login succeeded (`/login` -> `/docs`).
- Routes exercised: full Category 7 inventory (17/17): `login`, `setup`, `my-week`, `dashboard`, `docs`, `issues`, `projects`, `programs`, dynamic `document`, `team-allocation`, `team-directory`, `team-status`, `team-reviews`, `team-org-chart`, `admin`, `settings`, `settings/conversions`.
- Keyboard focus traces were captured on all routes (tab-step focus targets recorded per route).
- NVDA logs were captured (`spokenPhraseLog` and `itemTextLog`) but are predominantly `blank` or noisy/non-page-specific phrases, so announcement-level conformance remains only partially verified.



## Specific Weaknesses / Opportunities
1. Despite uniformly high Lighthouse accessibility scores (98), Axe found meaningful severe issue volume (1 critical, 49 serious), so score-only gating is insufficient.
2. Color contrast is the dominant severe issue class (49 serious node-level failures), making it the highest-leverage remediation area.
3. Keyboard completeness remains partial from smoke traversal checks and should be validated route-by-route with task-based keyboard workflows.
4. Auth redirect contamination was eliminated in this run (`0` redirected-to-login), so this baseline reflects actual protected-page scans.

## Severity/Impact Rankings
1. Partial keyboard navigation completeness - Medium impact, High priority.
2. Serious + critical Axe violations in full-route scan (1 critical, 49 serious) - High impact, High priority.
3. Color contrast failures (49) - High impact, High priority.
4. No ARIA/role-label gaps detected by Axe - Low risk.







