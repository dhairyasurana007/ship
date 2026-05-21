# Ship Codebase Audit Report

**Auditor:** Dhairya Surana  
**Date:** 2026-05-19  
**Environment:** Local dev — `http://localhost:5173` / `http://localhost:3000`  
**Database:** `ship_dev` (PostgreSQL local) — 257 documents, 11 users, 401 associations  
**Raw measurements:** [`AUDIT_measurements.log`](AUDIT_measurements.log)

---

## Methodology

All measurements were taken against the live local development environment with PostgreSQL running. API benchmarks used 20 sequential authenticated `curl` requests per endpoint (p50/p95/p99 computed from sorted latency list). Load testing with concurrent connections was attempted via `autocannon` but blocked by cookie-jar format incompatibility; sequential curl serves as a single-connection baseline. Database query plans were captured via `EXPLAIN (ANALYZE, BUFFERS)` using direct `node-postgres` queries. Accessibility scans used `axe-core 4.9.1` injected via Playwright into authenticated browser sessions. Type safety metrics were gathered via `grep` on `api/src`, `web/src`, and `shared/src`.

**Baseline caveat:** The local dataset (257 docs, 11 users) is substantially smaller than the audit spec's seeded targets (500+ docs, 100+ users). Latency numbers will be significantly lower than production at scale; DB query plan risks are noted for expected growth trajectories.

---

## Category 1: Type Safety

### Baseline Measurements

| Metric | Count | Notes |
|--------|-------|-------|
| Explicit `any` annotations | **286** | 272 api/, 14 web/, 1 shared/ |
| Type assertions (`as X`) | **1,341** | Across all packages |
| Non-null assertions (`!.`) | **24** | All packages |
| `@ts-ignore` / `@ts-expect-error` | **1** | Test file only (legitimate) |
| `strict: true` | All packages | Root tsconfig; api/ and shared/ inherit |
| `noUncheckedIndexedAccess` | api/ only | web/ defines own `compilerOptions` — flag absent |

### Findings

**F1.1 — HIGH: `web/tsconfig.json` does not extend root config**  
`web/tsconfig.json` declares its own `compilerOptions` block rather than extending the root tsconfig, which means `noUncheckedIndexedAccess`, `noImplicitReturns`, and `noFallthroughCasesInSwitch` are all absent for the entire frontend. Array index access in React components returns `T` instead of `T | undefined`, suppressing an entire class of runtime-crash bugs.

**F1.2 — MEDIUM: High `any` density in collaboration and route layers**  
286 explicit `any` annotations, concentrated in:
- `api/src/collaboration/index.ts` — WebSocket message handler, dynamic Yjs message typing
- `api/src/utils/yjsConverter.ts` — 6+ occurrences on Yjs mark/node conversion
- `api/src/routes/issues.ts`, `documents.ts`, `weeks.ts` — `pg` query result rows typed as `any` rather than using typed row generics (`pool.query<MyRow>(...)`)

**F1.3 — MEDIUM: 1,341 type assertions signal structural typing gaps**  
The volume of `as X` casts, concentrated in `UnifiedDocumentPage.tsx` and `App.tsx`, suggests route/document type unions are not narrowed before use. The pattern `document.belongs_to as any[]` bypasses the type system for a core data access.

**F1.4 — LOW: `@ts-expect-error` in test file is appropriate**  
`web/src/components/icons/uswds/Icon.test.tsx:63` is the sole suppression directive and is legitimately testing an invalid prop type. No action required.

### Recommendations

1. Have `web/tsconfig.json` extend the root config (`"extends": "../../tsconfig.json"`) and override only what's needed.
2. Add typed generics to `pg` queries: `pool.query<{ id: string; title: string }>('SELECT ...')`.
3. Replace route-layer `any` with interface types generated from the OpenAPI schema already present in the codebase.

---

## Category 2: Bundle Size

### Baseline Measurements

| Metric | Value |
|--------|-------|
| Total built assets | **2,262.65 KB** (2.21 MB) |
| Main JS chunk | **2,025.10 KB** (2.025 MB) |
| Main chunk as % of total JS | **97.3%** |
| Main chunk (gzipped) | **589.49 KB** |
| Total JS chunks | **261** |
| CSS bundle | 64.95 KB (1 file) |
| Build tool | Vite (`tsc && vite build`) |

### Chunk Breakdown (top 15)

| File | Size | Notes |
|------|------|-------|
| `index-C2vAyoQ1.js` | 2,025 KB | **Single main bundle — all application code** |
| `ProgramWeeksTab-*.js` | 16.37 KB | Route-split tab component |
| `WeekReviewTab-*.js` | 12.35 KB | Route-split tab component |
| `StandupFeed-*.js` | 9.42 KB | Route-split tab component |
| `ProjectRetroTab-*.js` | 8.83 KB | Route-split tab component |
| `ProjectWeeksTab-*.js` | 6.50 KB | Route-split tab component |
| `ProgramProjectsTab-*.js` | 4.30 KB | Route-split tab component |
| *(245 remaining)* | 0.65–1.76 KB each | USWDS icon SVG modules |

### Findings

**F2.1 — HIGH: Zero route-level code splitting**  
97.3% of all JavaScript ships in a single 2 MB chunk. Every user downloads the entire application — all routes, all editors, all page components — on first visit, regardless of which page they navigate to. The tab-level splits (ProgramWeeksTab, WeekReviewTab, etc.) exist but are negligible compared to the unsplit application core.

Vite emitted the warning `"Some chunks are larger than 500 kB after minification"` at build time. The 589 KB gzipped main chunk exceeds Google's recommended 200 KB budget for the critical render path.

**F2.2 — LOW: 245 USWDS icon chunks (0.65–1.58 KB each)**  
The USWDS icon set is split into ~245 individual JS files. While individually small, this creates 245 separate HTTP/2 streams on first load. Icons could be consolidated into a single icons chunk or handled via SVG sprites.

**F2.3 — INFO: CSS bundle is well-sized**  
64.95 KB for all CSS is reasonable and within acceptable limits.

### Recommendations

1. Add `React.lazy` + `Suspense` route-level splits for major page groups (issues, programs, wikis, settings). Target: main chunk under 500 KB gzipped.
2. Use `rollup-plugin-visualizer` to identify the largest library contributors inside the main chunk (likely TipTap, Yjs, and USWDS component library).
3. Evaluate tree-shaking for TipTap extensions — only import used extensions rather than the full suite.
4. Consolidate USWDS icons into a single chunked module.

---

## Category 3: API Response Time

### Baseline Measurements (20 sequential requests, local dev, 257 docs)

| Endpoint | p50 | p95 | p99 | Avg |
|----------|-----|-----|-----|-----|
| `GET /api/workspaces` | 18.4 ms | 24.1 ms | 24.5 ms | 18.5 ms |
| `GET /api/issues?workspace_id=X` | 28.3 ms | 40.0 ms | 43.8 ms | 28.1 ms |
| `GET /api/documents?workspace_id=X` | 24.4 ms | 30.1 ms | 30.5 ms | 24.0 ms |
| `GET /api/search?q=a&workspace_id=X` | 4.8 ms | 20.8 ms | 22.6 ms | 7.2 ms |
| `GET /api/weeks?workspace_id=X` | 22.6 ms | 37.8 ms | 47.9 ms | 24.3 ms |
| `GET /health` (no auth) | — | — | ~25.7 ms max | ~15.9 ms avg |

**Methodology limitations:** Sequential curl; not concurrent load. Dataset is ~50x smaller than production audit spec targets. Numbers will increase at scale primarily where unindexed sequential scans exist.

### Findings

**F3.1 — INFO: All endpoints well under 100ms p99 at current scale**  
All tested endpoints return under 50ms p99 with 257 documents. This is healthy for a small dataset.

**F3.2 — MEDIUM: Search p95 variance (4.8ms p50 to 20.8ms p95)**  
The search endpoint shows high variance. EXPLAIN ANALYZE confirms a full sequential scan with an `ILIKE` on `content::text` cast (see Category 4). At 2,500+ documents this endpoint will begin to lag significantly and variance will increase.

**F3.3 — MEDIUM: `/api/weeks` has highest p99 (47.9ms)**  
Weeks endpoint has the highest p99 in the set. This warrants further profiling; it may involve a complex join across `documents` + `document_associations` filtering for multiple document types per week.

**F3.4 — INFO: Concurrent load benchmarks not yet captured**  
autocannon was unable to establish an authenticated session (cookie-jar format incompatibility with session cookies). A concurrent benchmark with 10/25/50 connections against a seeded 500-document dataset would give production-relevant p95/p99 numbers. This is a gap in the audit baseline.

### Recommendations

1. Seed the local DB to audit-spec targets (500+ docs, 100+ users) and re-run with autocannon or `k6` to capture concurrent p95/p99.
2. Address the search ILIKE issue (Category 4, F4.1) before load testing — it is the most likely source of latency growth.
3. Profile `/api/weeks` with EXPLAIN ANALYZE to identify join/sort costs.

---

## Category 4: Database Query Efficiency

### Baseline Measurements

**Table sizes (pg_total_relation_size):**

| Table | Size |
|-------|------|
| `documents` | 696 KB |
| `document_associations` | 288 KB |
| `users` | 112 KB |
| `audit_logs` | 80 KB |
| `sessions` | 80 KB |

**Row counts:**  
- `users` = 11, `documents` = 257, `document_associations` = 401, `document_history` = **0**

**Indexes on `documents` table (13 total):**  
Primary key, `workspace_id`, `document_type`, `created_by`, `sprint_id`, `archived_at`, GIN on `properties`, `idx_documents_active` (partial btree on `workspace_id, document_type` WHERE `archived_at IS NULL AND deleted_at IS NULL`), and others.  
Notably absent: `ticket_number`, `created_at`.

### Query Plan Results

**EXPLAIN ANALYZE — Search (ILIKE):**
```
Seq Scan on documents (rows removed by filter: 132)
Filter: archived_at IS NULL AND workspace_id=X AND (title ~~* '%test%' OR content::text ~~* '%test%')
Planning Time: 4.011 ms | Execution Time: 2.643 ms
```

**EXPLAIN ANALYZE — Issues list with LEFT JOIN document_associations:**
```
Limit → Sort on created_at DESC [in-memory heapsort, 75 kB]
  → Hash Right Join (da.document_id = d.id)
      → Seq Scan on document_associations (401 rows)
      → Seq Scan on documents (filter: workspace_id + type + archived_at, removed 153)
Planning Time: 0.713 ms | Execution Time: 0.359 ms
```

### Findings

**F4.1 — HIGH: Search uses unindexable `content::text ILIKE` — O(n) at scale**  
The search query casts the `content` JSONB column to `text` for pattern matching: `content::text ILIKE '%q%'`. PostgreSQL cannot use any index for this cast pattern. As documents grow, this executes a full table scan and an expensive string match on the entire JSONB blob for every row. This is the most significant DB scalability risk in the codebase.

**F4.2 — MEDIUM: No `created_at` index — issues list sorts in memory**  
The issues list orders by `d.created_at DESC`. There is no index on `created_at`, so the planner uses an in-memory heapsort for every request. At 100+ issues this is fine; at 10,000+ issues this heapsort cost will dominate.

**F4.3 — MEDIUM: Sequential scan on `document_associations` for every issues request**  
Every issues page load triggers `Seq Scan on document_associations (rows=401)`. As this table grows with associations, the full scan cost compounds with the issues query.

**F4.4 — MEDIUM: `ticket_number` has no index**  
Issues have a `ticket_number` property stored in the JSONB `properties` column. No GIN expression index exists on `properties->>'ticket_number'`. Direct ticket number lookups (`WHERE properties->>'ticket_number' = 'SHIP-42'`) are full table scans.

**F4.5 — HIGH: `document_history` table is empty — audit trail not writing**  
The `document_history` table is defined and indexed but contains 0 rows. Either the code path that writes history was never implemented, was removed, or is broken. If this table is intended to record document changes for audit or undo purposes, that feature is silently absent.

**F4.6 — LOW: `idx_documents_active` partial index is well-designed**  
The partial index `(workspace_id, document_type) WHERE archived_at IS NULL AND deleted_at IS NULL` is an appropriate optimization for the common "list active documents by type" query pattern.

### Recommendations

1. Replace `content::text ILIKE` with a full-text search (`tsvector`/`tsquery`) or a dedicated `search_vector` computed column with a GIN index. Short-term: at minimum add `pg_trgm` GIN index on `title` for title search.
2. Add `CREATE INDEX idx_documents_created_at ON documents(workspace_id, created_at DESC) WHERE archived_at IS NULL`.
3. Add `CREATE INDEX idx_document_associations_document_id ON document_associations(document_id)` if not present.
4. Add GIN expression index: `CREATE INDEX idx_documents_ticket_number ON documents USING GIN ((properties->>'ticket_number'))` or a btree index if values are unique.
5. Investigate and fix `document_history` write path.

---

## Category 5: Test Coverage and Quality

### Baseline Measurements

| Layer | Files | Test Cases | Notes |
|-------|-------|------------|-------|
| E2E (Playwright) | 71 specs | 1,041 tests | Full user-flow coverage |
| API unit (Vitest) | 28 files | 30 cases | Extremely thin per file |
| Web unit (Vitest) | 1 file | ~5 cases | Icon component only |
| `test.fixme` / `test.skip` | 0 | — | No skipped tests |
| Coverage enforcement | Configured | — | Not run in CI or scripts |

### Findings

**F5.1 — HIGH: API unit test suite has only 30 cases across 28 files**  
28 test files averaging ~1.07 test cases each is not meaningful test coverage. The API routes (documents, issues, weeks, auth, search, programs) appear to have little to no unit test coverage of business logic. The E2E suite compensates but cannot cover internal contract guarantees.

**F5.2 — HIGH: Web unit test coverage is effectively zero**  
One test file exists (`Icon.test.tsx`), covering only the USWDS Icon component's prop validation. There are no tests for hooks (`useUnifiedDocuments`, `useEditor`, etc.), utilities, or any page-level component logic.

**F5.3 — MEDIUM: Coverage tooling is configured but never runs**  
`api/vitest.config.ts` configures v8 coverage with text and HTML reporters, but no `package.json` script invokes `--coverage`. There is no CI step enforcing a coverage threshold. Coverage is configured but dead.

**F5.4 — INFO: E2E suite is extensive (71 specs, 1,041 tests)**  
The E2E layer provides strong end-to-end flow coverage as a substitute for unit tests. The breadth (71 spec files) covers most user-facing workflows. However, E2E tests are slow, environment-dependent, and cannot test internal invariants or edge-case inputs.

**F5.5 — INFO: No skipped or fixme tests**  
There are no `test.fixme()` or `test.skip()` calls in the E2E suite, meaning every declared test is expected to run and pass.

### Recommendations

1. Add API unit tests for route handler logic — at minimum: auth, CSRF, document CRUD, search.
2. Add web unit tests for core hooks: `useUnifiedDocuments`, `useEditor`, `useDocumentSync`.
3. Add a `pnpm test:coverage` script in `api/package.json` and enforce a minimum threshold (e.g., 60% line coverage) in CI.
4. Consider splitting the E2E strategy into a fast smoke suite (10–15 critical paths) and a full regression suite to reduce CI cycle time.

---

## Category 6: Runtime Error and Edge Case Handling

### Baseline Measurements

| Check | Result |
|-------|--------|
| React ErrorBoundary placements | 2 (Editor + App router level) |
| Per-route / sidebar boundaries | 0 |
| Global `unhandledRejection` handler | Not found |
| API route files with coverage gap | 2 (`ai.ts`, `caia-auth.ts`) |
| `.then()` chains without `.catch()` | 0 |
| Console errors during authenticated navigation | 0 (only expected 401 pre-login) |

### Findings

**F6.1 — HIGH: No global `unhandledRejection` handler in the API server**  
`grep -rn "unhandledRejection\|uncaughtException" api/src` returned 0 matches. In Node.js, an unhandled async rejection that isn't caught by a route's try/catch will emit a deprecation warning and (in Node 15+) crash the process. Without a global handler, a single misbehaving async operation can take down the server.

**F6.2 — MEDIUM: `ai.ts` and `caia-auth.ts` each have one uncovered route**  
`ai.ts` has 3 routes with 2 catch blocks; `caia-auth.ts` has 3 routes with 2 catch blocks. Any unhandled error on the missing route will propagate to Express's default error handler, which returns a 500 with a stack trace in development — a potential information disclosure in production.

**F6.3 — MEDIUM: React ErrorBoundary coverage is coarse-grained**  
Only two boundaries exist: one wrapping the TipTap editor and one wrapping the entire app. A crash in the sidebar panel, properties panel, or any page component (outside the editor) will bubble to the app-level boundary, showing a full-page error state rather than an isolated failure. The 4-panel layout has no per-panel resilience.

**F6.4 — INFO: No `.then()` chains without `.catch()` in web**  
All Promise chains in the frontend correctly use either async/await with try/catch or `.catch()` on chain termination.

**F6.5 — INFO: No runtime errors during authenticated navigation**  
Browser console during authenticated navigation through `/docs`, `/issues`, and `/programs` showed no errors. The one 401 on `/api/auth/me` is expected pre-login behavior.

### Recommendations

1. Add a global handler in the server entry point:
   ```ts
   process.on('unhandledRejection', (reason) => {
     logger.error({ reason }, 'Unhandled rejection');
   });
   process.on('uncaughtException', (err) => {
     logger.fatal({ err }, 'Uncaught exception');
     process.exit(1);
   });
   ```
2. Add missing try/catch to the uncovered routes in `ai.ts` and `caia-auth.ts`.
3. Add per-panel ErrorBoundary wrappers for the sidebar, properties panel, and each page-level component in the 4-panel layout.

---

## Category 7: Accessibility Compliance

### Baseline Measurements (axe-core 4.9.1, authenticated Playwright session)

| Page | Critical | Serious | Moderate | Minor | Total |
|------|----------|---------|----------|-------|-------|
| `/docs` (Documents) | 0 | 0 | 0 | 0 | **0** |
| `/issues` | 0 | 0 | 0 | 0 | **0** |
| `/programs` | 0 | 0 | 0 | 0 | **0** |
| `/login` (redirected to `/docs`) | 0 | 0 | 0 | 0 | **0** |

**Static analysis:**

| Check | Result |
|-------|--------|
| ARIA label usages (`aria-label`, `aria-labelledby`, `aria-describedby`) | **116** |
| `<img>` tags missing `alt=` | **0** |
| Buttons with no visible label or aria-label (grep heuristic) | 0 detected |

### Findings

**F7.1 — PASS: Zero axe-core violations across all tested pages**  
axe-core 4.9.1 found no violations on the three primary authenticated pages (`/docs`, `/issues`, `/programs`). This is a strong result, consistent with the USWDS design system foundation which provides accessible components by default.

**F7.2 — INFO: Login page not independently scanned**  
The browser was already authenticated when navigating to `/login`, causing an immediate redirect to `/docs`. The login form's accessibility was not independently verified with axe. The login page should be scanned in an unauthenticated session.

**F7.3 — INFO: 116 ARIA annotations — thorough manual labeling**  
116 ARIA label usages across the frontend indicates deliberate accessibility work beyond USWDS defaults. Recent commits (`fix: use aria-label instead of aria-labelledby for USWDS Icon a11y`) show active maintenance.

**F7.4 — INFO: All images have alt attributes**  
No `<img>` tags are missing `alt=` attributes. This covers the WCAG 1.1.1 non-text content criterion.

### Recommendations

1. Scan the login page in an unauthenticated browser session to verify the form, labels, and CSRF input are accessible.
2. Consider adding keyboard navigation tests to the E2E suite (Tab order, focus trapping in modals, Escape key behavior).
3. Run axe against document editor views with content loaded — the TipTap editor area was not exercised in this audit pass.

---

## Summary Table

| ID | Category | Severity | Key Finding |
|----|----------|----------|-------------|
| F1.1 | Type Safety | HIGH | `web/tsconfig.json` does not extend root — `noUncheckedIndexedAccess` missing for frontend |
| F1.2 | Type Safety | MEDIUM | 286 `any` annotations, concentrated in collaboration and route layers |
| F1.3 | Type Safety | MEDIUM | 1,341 type assertions — structural typing gaps in document unions |
| F1.4 | Type Safety | LOW | Single `@ts-expect-error` in test file — legitimate |
| F2.1 | Bundle Size | HIGH | 97.3% of JS in a single 2,025 KB chunk — zero route-level code splitting |
| F2.2 | Bundle Size | LOW | 245 USWDS icon micro-chunks (0.65–1.58 KB each) |
| F2.3 | Bundle Size | INFO | CSS bundle (64.95 KB) is appropriately sized |
| F3.1 | API Response | INFO | All endpoints under 50ms p99 at current scale |
| F3.2 | API Response | MEDIUM | Search p50→p95 variance (4.8→20.8ms) driven by ILIKE sequential scan |
| F3.3 | API Response | MEDIUM | `/api/weeks` highest p99 at 47.9ms — warrants profiling |
| F3.4 | API Response | INFO | Concurrent load benchmarks not captured — methodology gap |
| F4.1 | DB Efficiency | HIGH | `content::text ILIKE` is unindexable — O(n) full scan scales with document count |
| F4.2 | DB Efficiency | MEDIUM | No `created_at` index — issues list sorts in memory |
| F4.3 | DB Efficiency | MEDIUM | Sequential scan on `document_associations` on every issues request |
| F4.4 | DB Efficiency | MEDIUM | No index on `ticket_number` — direct ticket lookups are full scans |
| F4.5 | DB Efficiency | HIGH | `document_history` table has 0 rows — audit trail silently not writing |
| F4.6 | DB Efficiency | LOW | `idx_documents_active` partial index is well-designed |
| F5.1 | Test Coverage | HIGH | API unit suite: 30 cases across 28 files — no meaningful business logic coverage |
| F5.2 | Test Coverage | HIGH | Web unit coverage: 1 test file (Icon component only) |
| F5.3 | Test Coverage | MEDIUM | Coverage configured but never runs — no CI enforcement |
| F5.4 | Test Coverage | INFO | E2E suite is extensive (71 specs, 1,041 tests) |
| F5.5 | Test Coverage | INFO | No skipped or fixme tests |
| F6.1 | Error Handling | HIGH | No global `unhandledRejection` handler — async crashes can kill the Node process |
| F6.2 | Error Handling | MEDIUM | `ai.ts` and `caia-auth.ts` each missing 1 route-level catch block |
| F6.3 | Error Handling | MEDIUM | Only 2 ErrorBoundary placements — sidebar/properties panels unprotected |
| F6.4 | Error Handling | INFO | No `.then()` chains without `.catch()` in web — clean |
| F6.5 | Error Handling | INFO | No runtime errors during authenticated navigation |
| F7.1 | Accessibility | PASS | 0 axe-core violations across all tested pages |
| F7.2 | Accessibility | INFO | Login page not scanned independently (authenticated redirect) |
| F7.3 | Accessibility | INFO | 116 ARIA annotations — thorough manual labeling |
| F7.4 | Accessibility | INFO | All images have alt attributes |

---

## Priority Remediation Order

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | F6.1 — Add `unhandledRejection`/`uncaughtException` handlers | 30 min | Server stability |
| 2 | F4.1 — Replace ILIKE search with `pg_trgm` or `tsvector` | Medium | DB scalability |
| 3 | F4.5 — Investigate and fix `document_history` write path | Unknown | Audit trail |
| 4 | F2.1 — Add route-level code splitting with `React.lazy` | Medium | Initial load time |
| 5 | F1.1 — Fix `web/tsconfig.json` to extend root config | Trivial | Type safety coverage |
| 6 | F5.1/F5.2 — Add unit tests for API routes and core web hooks | Ongoing | Regression safety |
| 7 | F4.2/F4.3/F4.4 — Add missing indexes | Low | Query performance at scale |
| 8 | F6.2 — Add missing catch blocks in `ai.ts` and `caia-auth.ts` | Trivial | Error isolation |
| 9 | F6.3 — Add per-panel ErrorBoundary wrappers | Low | UI resilience |
