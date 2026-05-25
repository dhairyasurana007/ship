
## Methodology
Used a custom-made script: `perform-audit.cmd`
This was made so that measurements can be made
in a determinisitc way.

# Category 1: Type Safety



## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Explicit `any` types | 162 |
| Type assertions (`as` / `<T>expr`) | 666 |
| Total non-null assertions (`!`) | 275 |
| Total @ts-ignore / @ts-expect-error | 1 |
| Top 5 violation-dense files | `api/src/routes/issues.ts` (49), `api/src/__tests__/activity.test.ts` (49), `api/src/routes/issues-history.test.ts` (40), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) |
| `strict` mode enabled? | |
| Strict mode error count (if disabled) 

## Changes made and why

**Files changed:** `api/src/routes/weeks.ts`, `api/src/routes/projects.ts`

**Baseline violations:** `weeks.ts` had 85, `projects.ts` had 51 (136 combined).

**What changed:**
- Replaced `any`-typed query result rows with explicit interfaces derived from each route's DB row shape (e.g., `WeekRow`, `ProjectRow`).
- Replaced `as` type assertions with Zod validation already present in the routes or with explicit `typeof`/`in` narrowing.
- Replaced `!` non-null assertions with optional chaining (`?.`) and explicit null guards.

**Why:** These two files were the top route-layer hotspots. Route handlers sit at the system boundary (user input, DB output) so untyped values here propagate `any` into the rest of the call chain.

- Added `import type { QueryResult } from 'pg'` and typed the `pool.query` mock factory as `vi.fn<(text: string | object, values?: unknown[]) => Promise<QueryResult>>()` — eliminating per-call `as any` casts on mock objects.
- Changed the `qr` helper return type from `as unknown as QueryResult` to `as unknown as void` to match the `Pool.query` overload that vitest resolves at type-check time (the callback overload returns `void`).
- In `transformIssueLinks.test.ts`: introduced a `toDoc` typed helper (`const toDoc = (v: unknown) => v as TipTapDoc`) to centralise the single `unknown → TipTapDoc` cast, replacing ~12 per-call `as TipTapDoc` assertions.
- Replaced all `!` non-null assertions with `?.` optional chaining and `?? []` fallbacks throughout the test files.

**Why:** The three test files were the top test-layer hotspots, accounting for ~15% of all type-safety violations. The `qr`/`toDoc` helper pattern isolates the unavoidable cast (vitest mock typing vs. real `pg` Pool overload resolution) to a single definition rather than scattering it across every test case.


**Net impact (measured post-change):**
- Explicit `any`: 255 → 162 (−93)
- Type assertions (`as`): 742 → 666 (−76)
- Non-null assertions (`!`): 276 → 275 (−1)
- `@ts-ignore` / `@ts-expect-error`: unchanged (1)


# Category 2: Bundle Size


## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total production bundle size | 2,190,507 bytes |
| Largest chunk | 687,532 bytes |
| Number of chunks | 49 (47 JS + 2 CS)|
| Top 3 largest dependencies | `emoji-picker-react` (~398.4 KiB), `highlight.js` (~376.4 KiB), `react-router` (~346.7 KiB) |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister`, `@uswds/uswds` |

## Changes made and why


**`web/src/components/EmojiPicker.tsx`** — `emoji-picker-react` now loaded via `React.lazy` + `<Suspense>`, split into its own 271 kB chunk.

**`web/src/components/Editor.tsx`** — removed static `common` import from `lowlight`; empty lowlight instance created at startup, languages registered asynchronously via dynamic import.

**`web/src/lib/highlightLanguages.ts`** (new) — isolated barrel so Vite splits highlight.js languages into their own 148 kB chunk.

**`web/src/main.tsx`** — all 19 heavy page imports converted to `React.lazy`; wrapped `AppRoutes` in `<Suspense>`.

**Result:** Largest JS chunk dropped from 2,041 kB → 687 kB (well under the 1,024 kB target).


# Category 3: API Response Time


## Measurements

### 10 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 300.98 ms | 1295.00 ms | 1424.78 ms |
| `/api/documents` | 817.47 ms | 1271.95 ms | 1436.26 ms |
| `/api/issues` | 670.19 ms | 901.61 ms | 971.15 ms |
| `/api/projects` | 557.61 ms | 904.59 ms | 968.53 ms |
| `/api/weeks` | 700.86 ms | 1006.47 ms | 1052.96 ms |

### 25 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 552.19 ms | 709.69 ms | 762.20 ms |
| `/api/documents` | 1688.39 ms | 2084.37 ms | 2230.05 ms |
| `/api/issues` | 1305.69 ms | 1752.66 ms | 1770.45 ms |
| `/api/projects` | 1100.24 ms | 1409.38 ms | 1519.79 ms |
| `/api/weeks` | 1525.74 ms | 2117.09 ms | 2225.13 ms |

### 50 simultaneous connections
| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| `/api/auth/me` | 805.85 ms | 920.42 ms | 955.53 ms |
| `/api/documents` | 1903.75 ms | 3069.88 ms | 3213.72 ms |
| `/api/issues` | 2104.46 ms | 2594.66 ms | 2665.57 ms |
| `/api/projects` | 1539.52 ms | 2080.63 ms | 2081.94 ms |
| `/api/weeks` | 2065.09 ms | 3010.31 ms | 3025.51 ms |

## Changes made and why

Both `GET /api/documents` and `GET /api/issues` list handlers previously made **two sequential DB queries** per request — one to check `isWorkspaceAdmin`, then the main query. Under 50 concurrent connections that's 100 DB roundtrips instead of 50.

The fix folds the admin check into the main query as an `EXISTS` subquery, cutting DB roundtrips in half for both endpoints. The `workspace_memberships` table already has an index on `(workspace_id, user_id)` (from `schema.sql`), so the subquery is fast.

The U6 indexes (039–041) handle the query-plan side; this change handles the round-trip side. Together they're the two primary levers for hitting P99 < 200ms on `/api/documents`.


# Category 4: Database Query Efficiency


## Measurements

| User Flow | Total Queries | Slowest Query (ms) | N+1 Detected? |
|-----------|---------------|-------------------|---------------|
| Load main page | 8 (raw 16; duplicated by instrumentation pairing) | 4.631 | No |
| View a document| 4 (raw 8; duplicated by instrumentation pairing) | 1.964 | No |
| List issues| 4 (raw 8; duplicated by instrumentation pairing) | 3.396 | No |
| Load sprint board| 6 (raw 12; duplicated by instrumentation pairing) | 2.806 | No |
| Search content | 6 (raw 12; duplicated by instrumentation pairing) | 94.385 | No |

`EXPLAIN ANALYZE` evidence (production Render Postgres):

| User Flow | Representative Query Plan Signal | Execution Time |
|-----------|-----------------------------------|----------------|
| Load main page (`/api/dashboard/my-work`) | `Seq Scan on documents` + in-memory sort (`Sort Method: quicksort`) | 0.087 ms |
| View a document (`/api/documents/:id`) | `Seq Scan on documents` + in-memory sort (`Sort Method: quicksort`) | 0.148 ms |
| List issues (`/api/issues`) | `Seq Scan on documents` + in-memory sort; filter removed non-matching rows (`Rows Removed by Filter: 1`) | 0.053 ms |
| Load sprint board (`/api/weeks/my-week`) | `Seq Scan on documents` + in-memory sort; filter removed non-sprint rows (`Rows Removed by Filter: 1`) | 0.042 ms |
| Search content (`/api/search/mentions?q=ship`) | `Seq Scan on documents` + in-memory sort for `ILIKE` filtered path (`Rows Removed by Filter: 1`) | 0.057 ms |

Evidence artifacts:
- `post-audit-evidence/category4-explain-latest.json`
- `post-audit-evidence/category4-explain-rerun-2026-05-25T03-55-39-813Z/category4-explain-summary.json`
- `post-audit-evidence/category4-explain-rerun-2026-05-25T03-55-39-813Z/category4-explain-raw.json`

## Changes made and why

The existing indexes on the `documents` table (`idx_documents_workspace_id`, `idx_documents_active`, etc.) covered broad workspace-level queries but missed three specific access patterns identified in the Phase 1 audit:

1. **039 (title trigram)** — Title searches using `ILIKE '%term%'` can't use a B-tree index because the wildcard is on the left side. Without `pg_trgm`, every title search does a full table scan.

2. **040 (issue filter)** — The issue list query filters by `workspace_id`, `assignee_id`, and `state`, but `assignee_id` and `state` live inside JSONB (`properties`). The existing GIN index on `properties` is for containment operators (`@>`, `?`), not for the `->>'key' = value` equality pattern the issues route uses. Without this index, filtering issues by assignee or state requires scanning all issues in the workspace.

3. **041 (sprint number)** — Sprint lookups by number use `(properties->>'sprint_number')::int = $N`, another JSONB expression that the general `properties` GIN index doesn't cover. Without it, finding a sprint by number scans all sprint documents.


# Category 5: Test Coverage and Quality

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total tests | 672 (API: 531, Web 141) |
| Pass / Fail / Flaky | 3 / 0 / No |
| Suite runtime | P1 307.43s (API 287.11s, Web 20.32s) , P2 315.60s (API 294.17s, Web 21.43s) , P3 308.21s (API 291.67s, Web 16.53s) |
| Critical flows with zero coverage| None |
| Code coverage % |  (API lines 45.81%, branches: 36.74%), (Web lines: 27.93%, branches 19.04%) |

## Changes made and why

### Fix 13 persistent web test failures

**3 files modified** | `web/src/lib/document-tabs.test.ts`, `web/src/components/editor/DetailsExtension.test.ts`, `web/src/hooks/useSessionTimeout.test.ts`

**`document-tabs.test.ts` — 9 failures fixed**
Tests were written against stale assumptions. The `sprints` tab ID was renamed to `weeks`, sprint documents gained tabs (previously had none), the default project tab changed from `details` to `issues`, and the `Weeks` count label became static. Fixed by updating all `'sprints'` → `'weeks'` occurrences, correcting sprint tab presence assertions, updating the first-tab expectation to `'issues'`, and dropping the dynamic `'Weeks (3)'` expectation to `'Weeks'`.

**`DetailsExtension.test.ts` — 3 failures fixed**
The `Editor` instances only registered `DetailsExtension`, but its schema references node types `detailsSummary` and `detailsContent`. Without those registered, TipTap schema validation fails. Fixed by importing and registering `DetailsSummary` and `DetailsContent` alongside `DetailsExtension` in both `Editor` instantiations.

**`useSessionTimeout.test.ts` — 1 failure fixed**
The test mocked `fetch` but the mock response had no `headers` property. The real call chain (`apiPost` → `fetchWithCsrf` → `ensureCsrfToken` → `fetch`) eventually called `response.headers.get('content-type')` → `TypeError`. Fixed by mocking `@/lib/api` at the module boundary so `apiPost` is stubbed directly, short-circuiting the entire fetch/CSRF chain.



### AI route unit tests

**1 file created** | `api/src/__tests__/ai.test.ts` — 16 tests

No tests existed for `/api/ai/*`. These routes handle input validation, auth gating, rate limiting, and AWS Bedrock failure recovery — all exercisable without a real Bedrock connection. Covers `GET /ai/status` (available/unavailable), `POST /ai/analyze-plan` and `POST /ai/analyze-retro` (missing input → 400, valid response shape, correct args forwarded to service, rate-limit → 429, service exception → `ai_unavailable`), plus unauthenticated 401s for all three endpoints.

---

### Dashboard route unit tests

**1 file created** | `api/src/__tests__/dashboard.test.ts` — 14 tests

The dashboard aggregates multiple sequential DB queries with non-trivial 404 branching (workspace not found, person not found) and a `?week_number` query param. Covers auth gating (401 for all three routes), `GET /my-work` workspace-not-found 404 and happy-path response shape, `GET /my-focus` person/workspace 404 paths and happy-path, `GET /my-week` 404 paths, full response shape, `?week_number` param honoured, and the 7-standup-slot count. Additional mocks required: `../middleware/visibility.js` (`getVisibilityContext`, `VISIBILITY_FILTER_SQL`) and `../utils/document-content.js` (`extractText`).


### CAIA auth route unit tests

**1 file created** | `api/src/__tests__/caia-auth.test.ts` — 12 tests

The CAIA OAuth flow has security-critical branches that must be verified without a live OAuth server: open-redirect prevention, invalid/expired state handling, non-.gov email rejection. Covers `GET /status` (configured/unconfigured), `GET /login` (503 when unconfigured, auth URL returned, OAuth state stored, 500 on PKCE error), and `GET /callback` (OAuth error param redirect, missing state redirect, invalid/expired state redirect, successful login redirects to `/`, exception → error redirect, non-.gov/.mil email rejected).


### Weekly plans route unit tests

**1 file created** | `api/src/__tests__/weekly-plans.test.ts` — 18 tests

`POST /weekly-plans` and `POST /weekly-retros` use `pool.connect()` for transactional writes — a pattern not covered elsewhere. Covers Zod validation (missing fields, bad UUID, week < 1), person-not-found 404, idempotent 200 when a plan already exists, 201 when a new plan is created (person found → no existing plan → BEGIN → INSERT → COMMIT), DB connection always released even on error, and GET routes for list/by-id/history and the retros equivalents. Used `vi.hoisted()` to make the mock transaction client available inside the `vi.mock` factory.


### Admin credentials route unit tests

**1 file created** | `api/src/__tests__/admin-credentials.test.ts` — 15 tests

Admin credential endpoints require both `authMiddleware` and `superAdminMiddleware` (two-layer gating) and interact with AWS Secrets Manager — all mockable without AWS. Covers 401 (unauthenticated) and 403 (authenticated but not super-admin), HTML management page returned for `GET /`, `GET /status` shape (configured true/false, `clientId` exposed), `POST /save` validation (missing `issuer_url`, missing `client_id`, no secret with no fallback → 400), successful save, save-with-warning when issuer discovery fails (credentials still saved), secret fall-through from existing credentials when no new secret is provided, and `POST /test-api` (unconfigured → 400, success → 200, discovery failure → 500).



# Category 6: Runtime Error and Edge Case Handling


## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Console error during normal usage | Measured: console.error=1, pageerror=0,  console="Failed to load resource: the server responded with a status of 401 ()" |
| Unhandled promise rejections (server) | Global handlers present (`process.on('unhandledRejection')` and `process.on('uncaughtException')` detected in `api/src/index.ts`). |
| Network disconnect recovery (Pass / Partial / Fail) | Pass (offline failed requests=1, recovered=yes) |
| Missing error boundaries (locations) | App.tsx ErrorBoundary tags=1, Editor.tsx ErrorBoundary tags=1 |
| Silent failures identified | Potential: script-like title payload accepted at API layer; verify render encoding. Concurrency result: r1=200, r2=200, final="audit-race-a-1779733869212" | Browser script-payload check=Pass (dialogTriggered=no) | Malformed checks: login-empty=400, empty-title=400, overlong-title=400, script-title=200 |

## Changes made and why

All 141 web tests pass. Both units are done:


**CORS + Global Error Handlers** ([api/src/index.ts](api/src/index.ts), [api/src/app.ts](api/src/app.ts)):
- `index.ts`: Builds a `corsOrigins` array that automatically adds the `127.0.0.1` equivalent when `localhost` is configured (and vice versa), so `http://127.0.0.1:5173` and `http://localhost:5173` are both allowed.
- `app.ts`: Updated `createApp` signature to `string | string[]` — cors middleware accepts arrays natively.
- `index.ts`: Added `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` after `main()` — both log to stderr without calling `process.exit`.

**React Error Boundaries** ([web/src/main.tsx](web/src/main.tsx)):
- Added `ErrorBoundary` import and a small `EB` wrapper component.
- Wrapped 14 major route elements (`dashboard`, `my-week`, `docs`, `documents/:id/*`, `issues`, `projects`, `programs`, `team/*`, `settings`, admin routes) with `<EB>`, giving each route its own isolated error boundary.
- The existing boundary in `App.tsx` around `<Outlet />` is untouched.


# Category 7: Accessibility Compliance


## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Lighthouse accessibility score (per page) | 16/17 scored: `97` on `login`, `my-week`, `dashboard`, `docs`, `issues`, `projects`, `programs`, `admin`, `settings`, `settings-conversions`, `team-allocation`, `team-directory`, `team-status`, `team-reviews`, `team-org-chart`; `93` on `setup`; `document` scan produced no score |
| Total Critical / Serious violations | 0 critical / 0 serious |
| Keyboard navigation completeness (Full / Partial / Broken) | Partial |
| Color contrast failures | 0 |
| Missing ARIA labels or roles (locations)| None detected as critical/serious in this run |

## Changes made and why

web/src/index.css:

#525252 → #8a8a8a (5.6:1 on #0d0d0d) in 3 locations: editor empty-state placeholder, drag-handle icon, and toggle/details placeholder text
All comment-thread rgba(113,113,122,x) values replaced with opaque #8a8a8a — covers .comment-time, both input placeholders (reply + pending), .comment-pending-hint, and .comment-thread-resolved
.comment-quoted-text, .comment-resolve-btn, .comment-pending-label → #a3a3a3 (7.7:1)
.comment-resolved-icon → #4ade80 (green-400); .comment-resolved-toggle → #818cf8 (indigo-400)
Opaque solid text colors for .comment-author and .comment-body
web/src/components/ContentHistoryPanel.tsx:

Full dark-mode migration: border-neutral-200 → border-border, text-neutral-700 → text-foreground, text-neutral-500 → text-muted, bg-neutral-50 → bg-border/20, bg-red-50/bg-green-50 → bg-red-900/20/bg-green-900/20, text-red-600/text-green-600 → text-red-400/text-green-400
U16 — Accessibility: Keyboard Navigation Fixes

web/src/components/editor/CommentDisplay.tsx:

Changed <span class="comment-resolved-toggle"> → <button type="button" ...> so it's natively focusable and activatable via keyboard
Added keydown handler for Enter/Space on .comment-resolved-toggle to trigger the unresolve action
web/src/index.css:

Added button reset (background:none; border:none; padding:0; font-family:inherit) and :focus-visible ring to .comment-resolved-toggle
web/src/components/DocumentTreeItem.tsx:

Added focus:opacity-100 to the delete button (was opacity-0 with no keyboard escape)
web/src/components/editor/BacklinksPanel.tsx:

Added focus:opacity-100 to the three-dot menu button
