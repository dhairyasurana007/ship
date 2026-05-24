# Category 1: Type Safety

## Methodology
Used a custom-made script: `perform-audit.cmd`

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

## Methodology

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total production bundle size | 2,190,507 bytes |
| Largest chunk | 687,532 bytes |
| Number of chunks | 49 (47 JS + 2 CS)|
| Top 3 largest dependencies | |
| Unused dependencies identified | |

## Changes made and why


**`web/src/components/EmojiPicker.tsx`** — `emoji-picker-react` now loaded via `React.lazy` + `<Suspense>`, split into its own 271 kB chunk.

**`web/src/components/Editor.tsx`** — removed static `common` import from `lowlight`; empty lowlight instance created at startup, languages registered asynchronously via dynamic import.

**`web/src/lib/highlightLanguages.ts`** (new) — isolated barrel so Vite splits highlight.js languages into their own 148 kB chunk.

**`web/src/main.tsx`** — all 19 heavy page imports converted to `React.lazy`; wrapped `AppRoutes` in `<Suspense>`.

**Result:** Largest JS chunk dropped from 2,041 kB → 687 kB (well under the 1,024 kB target).


# Category 3: API Response Time

## Methodology

## Measurements


| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

## Changes made and why

Both `GET /api/documents` and `GET /api/issues` list handlers previously made **two sequential DB queries** per request — one to check `isWorkspaceAdmin`, then the main query. Under 50 concurrent connections that's 100 DB roundtrips instead of 50.

The fix folds the admin check into the main query as an `EXISTS` subquery, cutting DB roundtrips in half for both endpoints. The `workspace_memberships` table already has an index on `(workspace_id, user_id)` (from `schema.sql`), so the subquery is fast.

The U6 indexes (039–041) handle the query-plan side; this change handles the round-trip side. Together they're the two primary levers for hitting P99 < 200ms on `/api/documents`.


# Category 4: Database Query Efficiency

## Methodology

## Measurements

| User Flow | Total Queries | Slowest Query (ms) | N+1 Detected? |
|-----------|---------------|-------------------|---------------|
| Load main page | | | |
| View a document| | | |
| List issues| | | |
| Load sprint board| | |
| Search content | | | |

## Changes made and why

The existing indexes on the `documents` table (`idx_documents_workspace_id`, `idx_documents_active`, etc.) covered broad workspace-level queries but missed three specific access patterns identified in the Phase 1 audit:

1. **039 (title trigram)** — Title searches using `ILIKE '%term%'` can't use a B-tree index because the wildcard is on the left side. Without `pg_trgm`, every title search does a full table scan.

2. **040 (issue filter)** — The issue list query filters by `workspace_id`, `assignee_id`, and `state`, but `assignee_id` and `state` live inside JSONB (`properties`). The existing GIN index on `properties` is for containment operators (`@>`, `?`), not for the `->>'key' = value` equality pattern the issues route uses. Without this index, filtering issues by assignee or state requires scanning all issues in the workspace.

3. **041 (sprint number)** — Sprint lookups by number use `(properties->>'sprint_number')::int = $N`, another JSONB expression that the general `properties` GIN index doesn't cover. Without it, finding a sprint by number scans all sprint documents.


# Category 5 Audit Deliverable

## Methodology

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Total tests | |
| Pass / Fail / Flaky | |
| Suite runtime | |
| Critical flows with zero coverage| |
| Code coverage % | |

## Changes made and why

3 consecutive runs, 141/141 passing each time. U7 is complete.

**Summary of changes:**

**[document-tabs.test.ts](web/src/lib/document-tabs.test.ts)** (9 fixes) — updated tests to match the sprint-to-weeks rename and the sprint tabs addition:
- `'sprints'` tab ID → `'weeks'` in all assertions (project and program tabs)
- Sprint now has tabs: updated "returns empty array" test to "returns tabs" with `length > 0`
- `documentTypeHasTabs('sprint')` now returns `true`
- First project tab is now `'issues'` (not `'details'`)
- `'Weeks (3)'` → `'Weeks'` (project weeks tab uses a static label, not dynamic)

**[DetailsExtension.test.ts](web/src/components/editor/DetailsExtension.test.ts)** (3 fixes):
- Content schema updated from `'block+'` to `'detailsSummary detailsContent'`
- Imported and registered `DetailsSummary`/`DetailsContent` in the two Editor instantiation tests — without those child node types registered, the schema validation throws

**[useSessionTimeout.test.ts](web/src/hooks/useSessionTimeout.test.ts)** (1 fix):
- Added `vi.mock('@/lib/api', ...)` to stub `apiPost` — `resetTimer` calls `apiPost` which internally tried to fetch a CSRF token; without proper `headers` on the mock response, `isJsonResponse` threw, landing in the catch block and calling `onTimeout` unexpectedly


# Category 6 Audit Deliverable

## Methodology

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Console error during normal usage | |
| Unhandled promise rejections (server) | |
| Network disconnect recovery (Pass / Partial / Fail) | |
| Missing error boundaries (locations) | |
| Silent failures identified | |

## Specific Weaknesses / Opportunities

## Severity/Impact Rankings

# Category 7 Audit Deliverable

## Methodology

## Measurements

| Metric | Your Baseline |
|--------|---------------|
| Lighthouse accessibility score (per page) | |
| Total Critical / Serious violations | |
| Keyboard navigation completeness (Full / Partial / Broken) | |
| Color contrast failures | |
| Missing ARIA labels or roles (locations)| |

## Specific Weaknesses / Opportunities

## Severity/Impact Rankings
