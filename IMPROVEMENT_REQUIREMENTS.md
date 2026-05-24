---
date: 2026-05-23
topic: shipshape-phase-2-improvements
---

# ShipShape Phase 2 — Improvement Requirements

## Summary

Requirements for all 7 Phase 2 improvement tracks derived from the Phase 1 audit baseline. Each track maps to a GFA Week 4 rubric category, carries numbered requirements with acceptance criteria, and targets measurable regression from the baseline documented in `AUDIT.md`.

---

## Problem Frame

The Phase 1 audit established a concrete baseline across 7 categories: 280 explicit `any` types concentrated in route files and test suites; a 1.98 MiB main bundle driven by three large unoptimized dependencies; `/api/documents` P99 latency reaching 714ms at 50 connections; three missing database indexes identified via `EXPLAIN ANALYZE`; 13 persistent web test failures and web branch coverage at 19.38%; a CORS origin mismatch masking runtime behavior in local dev and no global process error handlers; and 49 serious Axe color-contrast violations across all 17 routes.

No single category has been addressed yet. All 7 rubric dimensions have headroom, and several issues compound each other: the CORS mismatch obscures true error rates, the failing tests depress coverage numbers, and the missing DB indexes are the primary cause of the API latency bottleneck.

---

## Requirements

**Track 1 — Type Safety**

- R1. Remove or replace all explicit `any` types in `api/src/routes/weeks.ts` (audit baseline: 85 violations) with precise TypeScript types.
- R2. Remove or replace all explicit `any` types in `api/src/routes/projects.ts` (audit baseline: 51 violations) with precise TypeScript types.
- R3. Reduce `any` usage in the three hotspot test files: `api/src/__tests__/transformIssueLinks.test.ts` (66), `api/src/services/accountability.test.ts` (64), and `api/src/__tests__/auth.test.ts` (63).
- R4. Replace `as` type assertions with proper type narrowing or runtime-validated types within the top-5 hotspot files identified in the audit.
- R5. Replace non-null assertions (`!`) with explicit null checks or optional chaining within the top-5 hotspot files.

**Track 2 — Bundle Size**

- R6. Remove `@tanstack/query-sync-storage-persister` from `web/package.json`; verify zero remaining imports across `web/src/`.
- R7. Remove `@uswds/uswds` from `web/package.json`; verify zero remaining imports across `web/src/`.
- R8. Lazy-load the routes or components that pull in `emoji-picker-react` (~398 KiB) using dynamic imports so the library is not included in the initial bundle.
- R9. Lazy-load the routes or components that pull in `highlight.js` (~376 KiB) using dynamic imports so the library is not included in the initial bundle.
- R10. After Track 2 changes, a production build via `vite build` must produce a main JS chunk under 1,048,576 bytes (1 MiB); current baseline is ~2,073,741 bytes (~1.98 MiB).

**Track 3 — API Response Time**

- R11. Optimize the `/api/documents` query path so that P99 latency at 50 simultaneous connections is below 200ms; current baseline is 714ms.
- R12. Optimize the `/api/issues` query path to produce a measurable P99 reduction at 50 simultaneous connections from the 329ms baseline.
- R13. Re-run the benchmark (40 measured requests per endpoint, 50 simultaneous connections) after Track 3 and Track 4 changes are applied and record updated P50/P95/P99 values.

**Track 4 — Database Query Efficiency**

- R14. Add a PostgreSQL trigram index on `documents.title` (requires `pg_trgm` extension) to eliminate the sequential scan on `title ILIKE '%...%'` queries confirmed in `EXPLAIN ANALYZE`.
- R15. Add a composite or partial index on the `documents` table covering the assignee, state, and workspace filter predicates used by the main-page issue query (the plan showed `Rows Removed by Filter: 166`).
- R16. Add an expression index on `(properties->>'sprint_number')::int` to optimize sprint-board filtering on that extracted property.
- R17. All three index additions must be implemented as numbered migration files in `api/src/db/migrations/` following the existing `NNN_description.sql` convention; no direct edits to `api/src/db/schema.sql`.

**Track 5 — Test Coverage & Quality**

- R18. Fix all 13 persistent web test failures in the `document-tabs`, `DetailsExtension`, and `useSessionTimeout` test suites so that `pnpm test` produces 0 failures across 3 consecutive runs.
- R19. Add unit or integration test coverage for the AI analysis route module (`api/src/routes/` file(s) handling `/api/ai/*`).
- R20. Add unit or integration test coverage for the dashboard route module (file(s) handling `/api/dashboard/*`).
- R21. Add unit or integration test coverage for CAIA and PIV authentication routes (`/api/auth/caia/*`, `/api/auth/piv/*`).
- R22. Add unit or integration test coverage for the weekly plans route module (`/api/weekly-plans/*`).
- R23. Add unit or integration test coverage for the admin credentials route module (`/api/admin/credentials/*`).
- R24. After Track 5 changes, web branch coverage must be ≥ 40% as reported by the Vitest JSON summary (current baseline: 19.38%).

**Track 6 — Runtime Error & Edge Case Handling**

- R25. Fix the CORS origin mismatch: the API must accept both `http://127.0.0.1:5173` and `http://localhost:5173` as valid origins in local development, eliminating the repeated CORS-related fetch failures observed in the audit.
- R26. Add `process.on('unhandledRejection', handler)` and `process.on('uncaughtException', handler)` to the API server entry point; each handler must log the error and prevent silent process termination.
- R27. Expand React error boundary coverage in `web/` to wrap all major route trees and async data error paths beyond the existing boundaries in `web/src/pages/App.tsx` and `web/src/components/Editor.tsx`.

**Track 7 — Accessibility Compliance**

- R28. Fix all color-contrast violations identified in the Phase 1 Axe full-route scan (1 critical, 49 serious, all categorized as `color-contrast` failures across 17 routes).
- R29. Perform route-by-route keyboard navigation validation across all 17 routes in the Phase 1 inventory and fix any routes where keyboard access is broken or non-functional.
- R30. After Track 7 changes, an Axe full-route scan with an authenticated session must show 0 critical violations and fewer than 10 serious violations.

---

## Acceptance Examples

- AE1. **Covers R10.** Given a production build run via `vite build` after Track 2 changes, when `web/dist/assets/` is inspected, no single JS file exceeds 1,048,576 bytes.
- AE2. **Covers R18.** Given the full test suite run via `pnpm test` three times consecutively, when results are inspected across all three runs, each run shows 0 test failures.
- AE3. **Covers R25.** Given the API running locally and the web app served at `http://127.0.0.1:5173`, when the browser makes a fetch to any `/api/*` endpoint, the response succeeds without a CORS error in the browser console.
- AE4. **Covers R26.** Given a promise that rejects without a `.catch()` handler inside the API process, when the rejection fires, the API logs the error to stderr and continues handling subsequent requests.
- AE5. **Covers R30.** Given an Axe scan via `@axe-core/playwright` run against all 17 routes with an authenticated session, when scan results are aggregated, critical violation count equals 0 and serious violation count is below 10.

---

## Success Criteria

- All 4 key metrics from `IMPROVEMENT_STRATEGY.md` are met: (1) 0 failing tests + web branch coverage ≥ 40%; (2) production main JS chunk < 1 MiB; (3) `/api/documents` P99 < 200ms at 50 simultaneous connections; (4) 0 critical Axe violations, < 10 serious.
- Each of the 7 rubric categories shows a measurable improvement vs. the Phase 1 baseline recorded in `AUDIT.md`.
- A downstream planner (`ce-plan`) can execute any single track without inventing behavior, acceptance criteria, or scope boundaries.

---

## Scope Boundaries

- `security-probe/` folder — excluded entirely; no changes of any kind.
- `AUDIT.md` — Phase 1 baseline record; must not be modified.
- `IMPROVEMENT_STRATEGY.md` — planning baseline record; must not be modified.
- `IMPROVEMENT_PLAN.md` — planning baseline record; must not be modified.
- `IMPROVEMENT_REQUIREMENTS.md` — planning baseline record; must not be modified.
- New features — Phase 2 is improvements and fixes only; no new product functionality.
- Architectural refactors — the unified document model, 4-panel layout, and backend structure are out of scope.
- E2E tests — Track 5 targets unit and integration tests only; E2E work is a separate effort.
- Full type-safety cleanup — Track 1 targets the top-5 hotspot files only; the remaining codebase-wide `any`/`as`/`!` inventory (~1,200+ combined instances outside the hotspots) is not committed to in this phase.
- Screen-reader announcement quality — Track 7 addresses Axe violations and keyboard navigation; NVDA/Guidepup speech-log conformance verification is deferred.
- Production-environment benchmarking — all metrics are validated locally with seeded data (30 users, 750 docs, 180 issues, 16 sprints), consistent with the Phase 1 audit methodology.

---

## Key Decisions

- **Track 4 precedes Track 3:** The three missing DB indexes (R14–R16) are the primary mechanism behind the `/api/documents` latency problem. Track 3 query optimization should be planned and measured only after Track 4 indexes are applied.
- **Track 5 sequencing:** Fixing the 13 failing web tests (R18) is a prerequisite to coverage expansion (R19–R24). Adding new tests while the suite has persistent failures produces misleading coverage numbers and obscures whether new tests themselves pass.
- **Type safety scoped to hotspots:** R1–R5 target the 5 files with the highest violation density. A full codebase cleanup would exceed the Phase 2 deadline; hotspot files account for the majority of the audit's measured risk.

---

## Dependencies / Assumptions

- The `pg_trgm` PostgreSQL extension must be enabled in the local dev database before R14 can be applied. Assumed enabled in the Dockerized setup but should be verified before planning Track 4.
- The 13 failing web tests (R18) are deterministic regressions across all environments, not environment-dependent flakes. If investigation reveals an environment dependency, scope may need revision.
- Bundle size target (R10) assumes `emoji-picker-react` and `highlight.js` are isolatable via dynamic imports without restructuring the component tree. If the components are deeply entangled, Track 2 scope may expand.
- All performance metrics (R11–R13) are validated against local environment with seeded data, consistent with the Phase 1 audit benchmark methodology.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R11, R12] What query-level changes beyond DB indexes (Track 4) are needed to hit P99 < 200ms for `/api/documents`? Query restructuring, result pagination, or response caching may be required — investigate before Track 3 planning begins.

### Deferred to Planning

- [Affects R14][Needs research] Confirm `pg_trgm` is available in the local dev Postgres container before writing the migration.
- [Affects R28][Needs research] Produce a component-level inventory of the 49 color-contrast violations to identify which CSS tokens or components need updating before Track 7 fixes are planned.
- [Affects R29][Needs research] Enumerate specific keyboard navigation gaps per route before writing fixes — the audit recorded "Partial" without specifying which routes or interactions are broken.
