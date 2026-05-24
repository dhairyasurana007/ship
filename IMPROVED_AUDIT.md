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

## Specific Weaknesses / Opportunities

## Severity/Impact Rankings

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

## Specific Weaknesses / Opportunities

## Severity/Impact Rankings


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

## Specific Weaknesses / Opportunities

## Severity/Impact Rankings

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
