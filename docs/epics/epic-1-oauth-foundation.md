# Epic 1 — OAuth Foundation (Auth Code + PKCE, Device Grant)

## Before

Ship had no OAuth layer. Third-party apps could not authenticate. The agent (FleetGraph) called internal services directly with no audit trail.

## Fix

Added `oauth_apps` table (migration 057), authorization codes + access/refresh token tables (migration 058). Implemented `/oauth/authorize` consent screen with PKCE support (`code_challenge` + `code_challenge_method` recorded). `/oauth/token` verifies `BASE64URL(SHA256(code_verifier)) == code_challenge` — mismatch returns 400 `invalid_grant`. Device Authorization Grant added in `api/src/platform/oauth/device.ts` — `/oauth/device/code`, `/oauth/device/verify`, polling with `slow_down` semantics.

## After

Third-party apps can complete a full OAuth 2.0 authorization flow. CLI tools can authenticate without a browser via Device Grant.

## Proof

Unit tests in `api/src/platform/oauth/refresh.test.ts`. E2E Playwright test `e2e/oauth-pkce.spec.ts` covers happy path + wrong-verifier negative case.
