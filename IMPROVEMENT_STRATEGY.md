---
name: ShipShape Phase 2
last_updated: 2026-05-23
---

# ShipShape Phase 2 Strategy

## Target problem

Ship has measurable technical debt across 7 categories — untested critical flows, a 1.98 MiB main bundle, /api/documents latency of P99 714ms at 50 connections, 49 accessibility violations, and 280 explicit `any` types — that leaves the codebase fragile and the GFA Week 4 Phase 2 rubric score below its potential. Each category is independently improvable, but no single one has been addressed yet.

## Our approach

Make balanced, measurable improvements across all 7 audit categories by 2026-05-29 — targeting the highest-ROI fixes in each track without touching core architecture or introducing new features — so every rubric dimension moves and no category is left unaddressed.

## Who it's for

**Primary:** Government digital teams — they're hiring Ship to manage projects, documents, and sprints in a compliant, accessible workspace.

**Secondary:** GFA rubric evaluators — Phase 2 improvements are scoped to measurably improve each of the 7 audit categories.

## Key metrics

- **Test health** — 0 failing tests (from 13) + web branch coverage ≥ 40% (from 19.38%); measured via `pnpm test` coverage report
- **Bundle size** — Main chunk < 1 MiB (from 1.98 MiB); measured from `web/dist/assets` after production build
- **API tail latency** — `/api/documents` P99 < 200ms at 50 simultaneous connections (from 714ms); measured via benchmark script
- **Accessibility violations** — 0 critical Axe violations, < 10 serious (from 1 critical, 49 serious); measured via `@axe-core/playwright` full-route scan

## Tracks

### Track 1: Type Safety
Reduce explicit `any`, `as` assertions, and non-null assertions starting in the top-5 hotspot files (`api/src/routes/weeks.ts`, `api/src/routes/projects.ts`, and the three test files).

_Why it serves the approach:_ Directly addresses Category 1 rubric score; improves refactor safety across the codebase.

### Track 2: Bundle Size
Remove unused dependencies (`@tanstack/query-sync-storage-persister`, `@uswds/uswds`), lazy-load heavy routes that pull in `emoji-picker-react` (~398 KiB) and `highlight.js` (~376 KiB).

_Why it serves the approach:_ Category 2 score; reduces initial payload for government network environments.

### Track 3: API Response Time
Optimize the `/api/documents` query path (Category 3's primary bottleneck at P99 714ms @ 50 conns) and `/api/issues` secondary path.

_Why it serves the approach:_ Category 3 score; most user-visible performance improvement.

### Track 4: Database Query Efficiency
Add a trigram index for `title ILIKE '%...%'` search (Seq Scan evidence), a composite/expression index for issue assignee/state/workspace filters, and an expression index for `(properties->>'sprint_number')::int`.

_Why it serves the approach:_ Category 4 score; directly fixes EXPLAIN ANALYZE-confirmed gaps; enables Track 3 gains.

### Track 5: Test Coverage & Quality
Fix the 13 persistent web test failures (`document-tabs`, `DetailsExtension`, `useSessionTimeout`), then add test coverage for uncovered critical routes (AI analysis, dashboard, CAIA/PIV auth, weekly-plans, admin credentials).

_Why it serves the approach:_ Category 5 score; zero-failure baseline is table stakes before coverage work.

### Track 6: Runtime Error & Edge Case Handling
Fix the CORS origin mismatch (`127.0.0.1` vs `localhost`), add global `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers, and expand error boundary coverage in the React tree.

_Why it serves the approach:_ Category 6 score; fixes the issue masking all runtime behavior in local dev; required for production-readiness.

### Track 7: Accessibility Compliance
Fix all 49 color-contrast violations (the sole source of the 1 critical + 49 serious Axe findings), then validate keyboard navigation completeness route-by-route.

_Why it serves the approach:_ Category 7 score; government apps have mandatory accessibility requirements (Section 508).

## Milestones

- **2026-05-29** — Phase 2 submission: all 7 tracks show measurable improvement vs. Phase 1 baseline

## Not working on

- `security-probe/` folder (excluded entirely)
- `AUDIT.md` (baseline record — do not modify)
- New features (Phase 2 is improvements only)
- Architectural refactors (document model, 4-panel layout, backend structure)
