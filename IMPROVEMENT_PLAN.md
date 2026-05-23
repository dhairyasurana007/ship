---
date: 2026-05-23
topic: shipshape-phase-2-improvements
origin: IMPROVEMENT_REQUIREMENTS.md
status: active
---

# ShipShape Phase 2 — Improvement Plan

## Problem Frame

Ship has measurable technical debt across 7 GFA Week 4 rubric categories. All baselines are established in `AUDIT.md`. Phase 2 delivers one atomic commit per implementation unit, ordered hardest category first so the most effort-intensive work lands before the deadline (2026-05-29).

**Assumption (converted from "Resolve Before Planning"):** DB indexes (Track 4) are the primary lever for hitting `/api/documents` P99 < 200ms. If P99 remains above 200ms after Track 4 is applied, the Track 3 unit expands to include query restructuring or pagination — that decision is deferred to implementation.

---

## Commit Ordering (Hard First)

| Unit | Track | Commit description |
|---|---|---|
| U1 | 5 | Fix 13 persistent web test failures |
| U2 | 5 | Add tests: AI analysis routes |
| U3 | 5 | Add tests: dashboard routes |
| U4 | 5 | Add tests: CAIA/PIV auth routes |
| U5 | 5 | Add tests: weekly plans routes |
| U6 | 5 | Add tests: admin credentials routes |
| U7 | 1 | Type safety: fix route hotspots (weeks + projects) |
| U8 | 1 | Type safety: fix test hotspots (3 test files) |
| U9 | 7 | Accessibility: fix 49 color-contrast violations |
| U10 | 7 | Accessibility: keyboard navigation fixes |
| U11 | 4 | DB indexes: migrations 039–041 |
| U12 | 3 | API latency: optimize /api/documents + /api/issues |
| U13 | 2 | Bundle: remove unused dependencies |
| U14 | 2 | Bundle: lazy-load emoji-picker-react + highlight.js |
| U15 | 6 | Runtime: fix CORS + add global error handlers |
| U16 | 6 | Runtime: expand React error boundaries |

---

## Implementation Units

### U1. Fix 13 Persistent Web Test Failures

**Goal:** Eliminate all 13 deterministic web test failures so the suite reaches 0 failures across 3 consecutive runs.

**Requirements:** R18

**Dependencies:** none

**Files:**
- `web/src/lib/document-tabs.test.ts`
- `web/src/components/editor/DetailsExtension.test.ts`
- `web/src/hooks/useSessionTimeout.test.ts`
- Source files under test (modify only if the source has regressed; prefer fixing the test when the contract still holds)

**Approach:** Diagnose each failure before touching code. Common causes: changed exports or renamed functions in `document-tabs`, TipTap API changes that broke `DetailsExtension.config.*` property access, and timer/React version incompatibilities in `useSessionTimeout`. Fix tests to match current contracts; fix source only when the contract itself regressed.

**Test scenarios:**
- All tests in `document-tabs.test.ts` pass (`getTabsForDocumentType`, `documentTypeHasTabs`, `resolveTabLabels`, `documentTabConfigs`)
- All tests in `DetailsExtension.test.ts` pass (extension existence, config properties, editor instantiation)
- All tests in `useSessionTimeout.test.ts` pass with fake timers (initial state, warning trigger, timeout trigger, activity reset)
- Covers AE2: `pnpm test` run 3 times consecutively, all runs show 0 failures

**Verification:** `pnpm test` in `web/` shows 0 failures; run 3 times to confirm stability.

---

### U2. Add Tests: AI Analysis Routes

**Goal:** Cover the `/api/ai/*` route module with unit/integration tests.

**Requirements:** R19

**Dependencies:** U1 (stable baseline required)

**Files:**
- `api/src/routes/ai.ts` (read to understand shape)
- `api/src/__tests__/ai.test.ts` (create)

**Approach:** Follow the pattern in `api/src/__tests__/auth.test.ts` for authenticated route tests. Cover: unauthenticated request returns 401, valid request returns expected shape, invalid/missing body returns 400.

**Test scenarios:**
- Unauthenticated `POST /api/ai/*` returns 401
- Authenticated request with valid payload returns 200 with expected response shape
- Authenticated request with missing required fields returns 400
- At least one happy-path test per distinct AI endpoint

**Verification:** `pnpm test` in `api/` passes; coverage for the AI route module is non-zero in JSON summary.

---

### U3. Add Tests: Dashboard Routes

**Goal:** Cover `/api/dashboard/*` with unit/integration tests.

**Requirements:** R20

**Dependencies:** U1

**Files:**
- `api/src/routes/dashboard.ts` (read to understand shape)
- `api/src/__tests__/dashboard.test.ts` (create)

**Approach:** Same pattern as U2. Dashboard routes likely aggregate data — test that the response shape is correct and that the workspace/auth scoping is enforced.

**Test scenarios:**
- Unauthenticated request returns 401
- Authenticated request returns 200 with correct structure
- Request for a workspace the user does not belong to returns 403 or empty data

**Verification:** `pnpm test` in `api/` passes; dashboard route module has non-zero coverage.

---

### U4. Add Tests: CAIA/PIV Auth Routes

**Goal:** Cover `/api/auth/caia/*` and `/api/auth/piv/*` with unit/integration tests.

**Requirements:** R21

**Dependencies:** U1

**Files:**
- `api/src/routes/auth.ts` or relevant CAIA/PIV route file (read to understand shape)
- `api/src/__tests__/auth-caia-piv.test.ts` (create)

**Approach:** CAIA/PIV auth involves external OAuth flows — mock the external calls. Test that missing/invalid tokens are rejected, that successful callback handling creates a session, and that redirect behavior is correct.

**Test scenarios:**
- Callback with missing token returns 400 or redirects with error
- Callback with valid mocked token creates session and redirects correctly
- Duplicate login attempt with existing session is handled gracefully

**Verification:** `pnpm test` in `api/` passes; CAIA/PIV route coverage is non-zero.

---

### U5. Add Tests: Weekly Plans Routes

**Goal:** Cover `/api/weekly-plans/*` with unit/integration tests.

**Requirements:** R22

**Dependencies:** U1

**Files:**
- `api/src/routes/weekly-plans.ts` (read to understand shape)
- `api/src/__tests__/weekly-plans.test.ts` (create)

**Approach:** Follow existing route test patterns. Test CRUD operations: list returns scoped results, create validates required fields, update is workspace-scoped.

**Test scenarios:**
- Unauthenticated request returns 401
- `GET /api/weekly-plans` returns only plans belonging to the authenticated user's workspace
- `POST /api/weekly-plans` with missing required fields returns 400
- `POST /api/weekly-plans` with valid body creates a document and returns 201

**Verification:** `pnpm test` in `api/` passes; weekly-plans route coverage is non-zero.

---

### U6. Add Tests: Admin Credentials Routes

**Goal:** Cover `/api/admin/credentials/*` with unit/integration tests; confirm web branch coverage reaches ≥ 40%.

**Requirements:** R23, R24

**Dependencies:** U1

**Files:**
- `api/src/routes/admin.ts` or credentials route file (read to understand shape)
- `api/src/__tests__/admin-credentials.test.ts` (create)

**Approach:** Admin routes require elevated permissions — test that non-admin users are rejected (403), that admin users can read/write credentials, and that sensitive fields are not leaked in non-admin responses. After all Track 5 units land, run coverage and verify web branch ≥ 40%.

**Test scenarios:**
- Non-admin authenticated request returns 403
- Admin request returns credential list with expected shape
- Create credential with invalid body returns 400
- After U2–U6 land: web branch coverage ≥ 40% confirmed in JSON summary

**Verification:** `pnpm test` in `api/` passes; web branch coverage ≥ 40%.

---

### U7. Type Safety: Fix Route Hotspots

**Goal:** Eliminate `any`, `as`, and `!` violations in `api/src/routes/weeks.ts` (85 violations) and `api/src/routes/projects.ts` (51 violations).

**Requirements:** R1, R2, R4, R5

**Dependencies:** none

**Files:**
- `api/src/routes/weeks.ts`
- `api/src/routes/projects.ts`

**Approach:** Work file by file. Replace `any` with precise types derived from DB row shapes (use `pg` result typing or explicit interfaces). Replace `as` assertions with type narrowing (`typeof`, `in` checks, or Zod validation already present in routes). Replace `!` with optional chaining or explicit null checks. Do not change observable API behavior.

**Patterns to follow:** Existing typed routes in the codebase; Zod schemas already present in `api/src/routes/documents.ts` for validation patterns.

**Test scenarios:**
- `pnpm type-check` passes with zero new errors after changes
- Existing tests for weeks and projects routes still pass

**Verification:** `pnpm type-check` clean; `pnpm test` in `api/` passes.

---

### U8. Type Safety: Fix Test Hotspots

**Goal:** Reduce `any` usage in the three highest-violation test files.

**Requirements:** R3, R4, R5

**Dependencies:** none

**Files:**
- `api/src/__tests__/transformIssueLinks.test.ts` (66 violations)
- `api/src/services/accountability.test.ts` (64 violations)
- `api/src/__tests__/auth.test.ts` (63 violations)

**Approach:** Replace `any` in test fixtures and mock objects with typed equivalents. Use `Partial<T>` or explicit interfaces for partial test objects rather than `as any`. Replace `as any` casts on mock responses with correctly-typed mock factories.

**Test scenarios:**
- `pnpm type-check` passes with zero new errors
- All tests in the three files still pass

**Verification:** `pnpm type-check` clean; `pnpm test` in `api/` passes.

---

### U9. Accessibility: Fix Color-Contrast Violations

**Goal:** Fix all 49 serious + 1 critical Axe `color-contrast` failures across the 17-route inventory.

**Requirements:** R28

**Dependencies:** none

**Files:**
- `web/src/styles/` (global CSS/token files)
- `web/tailwind.config.*` or theme config if contrast is defined there
- Component files identified during the Axe component-level inventory run at implementation time

**Approach:** Run Axe via `@axe-core/playwright` to produce the component-level inventory (this is the "Deferred to Planning" step from requirements). Group violations by component/token. Fix at the token/theme level first (one change fixes the most surface); then fix component-level overrides. Target WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI components.

**Test scenarios:**
- After fixes, Axe full-route scan shows 0 `color-contrast` critical violations
- After fixes, Axe total serious violations < 10 (Covers AE5 in part)
- `pnpm build` succeeds with no new errors

**Verification:** Axe scan passes AE5 criteria threshold.

---

### U10. Accessibility: Keyboard Navigation Fixes

**Goal:** Fix broken keyboard navigation paths identified in route-by-route validation.

**Requirements:** R29, R30

**Dependencies:** U9 (clean Axe baseline)

**Files:**
- Component files with broken focus management (identified during route validation at implementation time)
- Potentially `web/src/components/ui/` modal, dropdown, or menu components

**Approach:** Tab through each of the 17 routes with keyboard only. Document which interactions are unreachable or trap focus. Fix by adding `tabIndex`, `onKeyDown` handlers, or `aria-*` attributes where missing. Do not replace mouse-only handlers — add keyboard equivalents alongside.

**Test scenarios:**
- All interactive elements on primary routes are reachable via Tab
- No keyboard focus traps from modals or menus
- Covers AE5: Axe scan post-fix shows 0 critical, < 10 serious (regression check against U9)

**Verification:** Manual keyboard walkthrough passes all 17 routes; Axe scan confirms R30/AE5.

---

### U11. DB Indexes: Migrations 039–041

**Goal:** Add the three missing indexes identified via `EXPLAIN ANALYZE` in the Phase 1 audit.

**Requirements:** R14, R15, R16, R17

**Dependencies:** none

**Files:**
- `api/src/db/migrations/039_trgm_title_search.sql` (create)
- `api/src/db/migrations/040_issue_filter_index.sql` (create)
- `api/src/db/migrations/041_sprint_number_expression_index.sql` (create)

**Approach:**

*039:* Enable `pg_trgm` extension if not present, then create a GIN trigram index on `documents.title` using `gin_trgm_ops`. First verify `pg_trgm` is available: `SELECT * FROM pg_extension WHERE extname = 'pg_trgm'`.

*040:* Composite partial index on `documents (workspace_id, document_type, assignee_id, state)` filtered to `WHERE document_type = 'issue' AND deleted_at IS NULL`.

*041:* Expression index on `(properties->>'sprint_number')` filtered to `WHERE document_type = 'sprint'`.

Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for all three. Wrap each migration in `BEGIN`/`COMMIT` per existing convention. Note: `CONCURRENTLY` cannot run inside a transaction block in Postgres — check existing migration runner behavior and adjust wrapping if needed.

**Test scenarios:**
- `pnpm db:migrate` applies all three migrations without error on a fresh local DB
- `EXPLAIN ANALYZE` for `title ILIKE '%ship%'` shows index scan after 039
- `EXPLAIN ANALYZE` for the main-page issue query shows filter improvement after 040
- `EXPLAIN ANALYZE` for sprint-board query shows expression index usage after 041

**Verification:** Migrations apply cleanly; `EXPLAIN` plans confirm index usage for each targeted query.

---

### U12. API Latency: Optimize /api/documents and /api/issues

**Goal:** Reduce `/api/documents` P99 to < 200ms and `/api/issues` P99 measurably, at 50 simultaneous connections.

**Requirements:** R11, R12, R13

**Dependencies:** U11 (indexes must be applied and verified first)

**Files:**
- `api/src/routes/documents.ts`
- `api/src/routes/issues.ts` or the file handling `/api/issues` list queries

**Approach:** Re-run the benchmark after U11 lands to isolate the index contribution. If P99 is still above 200ms: (a) audit the list query for unnecessary columns and trim the SELECT, (b) add result pagination for large workspaces if missing, (c) evaluate a short-lived response cache if the data is read-heavy. Apply the minimum change that reaches the target and record updated P50/P95/P99 values.

**Test scenarios:**
- Benchmark at 50 connections shows `/api/documents` P99 < 200ms
- Benchmark at 50 connections shows `/api/issues` P99 lower than 329ms baseline
- Existing documents and issues route tests still pass

**Verification:** Updated benchmark numbers recorded; `pnpm test` in `api/` passes.

---

### U13. Bundle: Remove Unused Dependencies

**Goal:** Remove `@tanstack/query-sync-storage-persister` and `@uswds/uswds` from the web bundle entirely.

**Requirements:** R6, R7

**Dependencies:** none

**Files:**
- `web/package.json`
- Any `web/src/` file that imports either package (grep first; remove imports before removing packages)

**Approach:** Grep `web/src/` for imports of both packages. If imports exist, remove them from source first. Then remove both from `web/package.json` and run `pnpm install`. Run `pnpm build` to confirm no missing-module errors.

**Test scenarios:**
- `pnpm build` in `web/` succeeds after removal
- No TypeScript import errors referencing either package
- `pnpm test` in `web/` still passes

**Verification:** Neither package appears in `web/package.json`; build passes.

---

### U14. Bundle: Lazy-Load Heavy Imports

**Goal:** Move `emoji-picker-react` (~398 KiB) and `highlight.js` (~376 KiB) out of the initial bundle, reducing the main chunk below 1 MiB.

**Requirements:** R8, R9, R10

**Dependencies:** U13

**Files:**
- `web/src/` components or routes that import `emoji-picker-react` (identify via grep)
- `web/src/` components or routes that import `highlight.js` (identify via grep)

**Approach:** Wrap React components using `emoji-picker-react` in `React.lazy(() => import(...))` with a `<Suspense>` fallback. For `highlight.js`, if used in a non-React utility context, use a dynamic `import()` at call-site. After changes, run a production build and check that no single JS file in `web/dist/assets/` exceeds 1,048,576 bytes (Covers AE1).

**Test scenarios:**
- Covers AE1: production build largest JS chunk < 1,048,576 bytes
- Emoji picker renders correctly when the relevant UI is opened (manual check)
- Code highlighting renders correctly in documents with code blocks (manual check)
- `pnpm test` in `web/` still passes

**Verification:** `web/dist/assets/` largest JS file < 1 MiB confirmed after build.

---

### U15. Runtime: Fix CORS + Add Global Error Handlers

**Goal:** Eliminate CORS-related fetch failures in local dev; prevent silent crashes from unhandled rejections.

**Requirements:** R25, R26

**Dependencies:** none

**Files:**
- `api/src/index.ts` (or the file where `cors()` middleware and server startup live)

**Approach:**

*CORS (R25):* Locate the `cors()` middleware call. Update the `origin` option to accept both `http://127.0.0.1:5173` and `http://localhost:5173` using an array or an origin-checking function. Verify the fix manually: load the web app at `http://127.0.0.1:5173` and confirm no CORS errors appear in browser DevTools (Covers AE3).

*Error handlers (R26):* After the server startup block, register `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)`. Each handler logs the error to stderr. Do not call `process.exit()` by default (Covers AE4).

**Test scenarios:**
- Covers AE3: web app at `http://127.0.0.1:5173` fetches `/api/*` without CORS errors in the console
- Covers AE4: a simulated unhandled rejection confirms the handler fires and logs without crashing the process
- Existing API tests still pass

**Verification:** `pnpm dev` with web at `http://127.0.0.1:5173` shows no CORS errors; `pnpm test` in `api/` passes.

---

### U16. Runtime: Expand React Error Boundaries

**Goal:** Wrap all major route trees and async data paths in error boundaries beyond the existing two.

**Requirements:** R27

**Dependencies:** none

**Files:**
- `web/src/pages/App.tsx` (existing boundary — extend or wrap at route level)
- Route-level components that load async data without a wrapping boundary (identify via grep for `useQuery`, `useFetch`, or similar)
- `web/src/components/ErrorBoundary.tsx` (create if a reusable boundary component does not already exist)

**Approach:** Audit the current React tree. `App.tsx` has a top-level boundary; `Editor.tsx` has one. Add per-route boundaries around the main content area of each major route so an error in one route does not blank the whole app. Use a simple fallback UI ("Something went wrong — reload the page"). Do not remove existing boundaries.

**Test scenarios:**
- A route component that throws during render shows the error fallback instead of crashing the whole app
- The existing `App.tsx` and `Editor.tsx` boundaries are not removed or weakened
- `pnpm test` in `web/` still passes

**Verification:** Manual test — trigger a thrown error in one route component, confirm fallback renders and other routes stay functional.

---

## Key Technical Decisions

- **Track 4 before Track 3** (see `IMPROVEMENT_REQUIREMENTS.md`): DB indexes are the primary latency lever. Measuring post-index P99 before applying query-layer changes ensures indexes get credit and avoids over-engineering.
- **Track 5 sequencing**: U1 (fix failures) must land before U2–U6 (add tests). Adding tests to a failing suite produces misleading coverage numbers.
- **`CONCURRENTLY` for all index builds**: Avoids table locks in dev and prod. Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block — check the migration runner and wrap accordingly.
- **Type safety scoped to hotspots**: Full codebase cleanup (~1,200+ remaining instances) is deferred per `IMPROVEMENT_REQUIREMENTS.md`.

---

## Scope Boundaries

- `security-probe/` folder — excluded entirely
- `AUDIT.md` — must not be modified
- New features — no new product functionality
- Architectural refactors — document model, 4-panel layout, backend structure
- E2E tests — unit/integration only
- Full type-safety cleanup — top-5 hotspot files only (U7, U8)
- Screen-reader announcement quality — deferred (Track 7 covers Axe + keyboard only)
- Production benchmarking — all metrics validated locally with seeded data

### Deferred to Follow-Up Work

- Full `any`/`as`/`!` cleanup across remaining ~1,200+ instances outside hotspot files
- Concurrent-edit conflict cues (last-write-wins noted in audit, out of Phase 2 scope)
- Offline/recovery UX improvement (partial recovery noted in audit)
- NVDA speech-log conformance verification

---

## Dependencies / Assumptions

- `pg_trgm` extension available in local dev Postgres — verify before U11 with `SELECT * FROM pg_extension WHERE extname = 'pg_trgm'`
- U12 P99 target assumes U11 indexes are the primary latency lever; if not, U12 scope expands to query restructuring or pagination
- All performance metrics re-validated locally with seeded data (30 users, 750 docs, 180 issues, 16 sprints)
- `CREATE INDEX CONCURRENTLY` behavior in migration runner — verify it is not wrapped in an explicit transaction

---

## Success Criteria

- 0 failing web tests across 3 consecutive runs; web branch coverage ≥ 40%
- Production main JS chunk < 1 MiB
- `/api/documents` P99 < 200ms at 50 simultaneous connections
- Axe full-route scan: 0 critical violations, < 10 serious violations
- Each of the 7 rubric categories shows measurable improvement vs. `AUDIT.md` baseline
