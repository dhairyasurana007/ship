# Epic 2 — Public API Boundary + Bearer Middleware

## Before

No `/api/v1/` surface existed. All routes were internal with session-cookie auth. No scope-based access control.

## Fix

Created `api/src/platform/api/v1/router.ts` — standalone Express router that imports only from `platform/`. Mounted at `app.use("/api/v1", v1Router)`. Added ESLint `no-restricted-imports` rules preventing cross-boundary imports. `bearerAuth.ts` middleware validates OAuth tokens on every `/api/v1/*` route. `requireScope()` factory returns 403 with the missing scope named explicitly.

## After

Clean public/internal split enforced by lint. Bearer auth on all public routes. Scope checks at each endpoint.

## Proof

`pnpm lint` exits 0. `api/src/platform/middleware/__tests__/bearerAuth.test.ts` and `requireScope.test.ts` all pass.
