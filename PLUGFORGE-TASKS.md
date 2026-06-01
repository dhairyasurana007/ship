# PLUGFORGE-TASKS.md
## Implementation Tasks — Ship Platform

> Source of truth: **PLUGFORGE-PLAN.md**
>
> Workflow for every task: **implement → verify locally → push → CI gates → if red, fix and repeat**
>
> Never push a failing local test. Never skip the fitness test. Never hand-write the OpenAPI spec.
>
> **Test environment:** `https://ship-web-ak37.onrender.com` — credentials: `dev@ship.local` / `admin123`

---

## How to work through a task

```
1. Implement the task (files listed under each task)
2. Run the verification commands (tests + curl assertions listed under each task)
3. Any test failing or curl assertion not matching? → fix → re-run until all pass
4. All passing? → git push directly to branch → check the box and move to the next task
```

---

## Section 1 — MVP

> Hard gate. All 10 tasks required before Tuesday 11:59 PM CT. Order matters — each task unblocks the next.

---

### M1 — OAuth App Registration

**What to build:**
- Migration `api/src/db/migrations/057_oauth_apps.sql` — `oauth_apps` table: `id`, `client_id` (UUID), `hashed_client_secret`, `name`, `redirect_uris` (text[]), `owner_id`, `requested_scopes` (text[]), `created_at`
- Migration `api/src/db/migrations/058_oauth_tokens.sql` — `oauth_authorization_codes`, `oauth_access_tokens`, `oauth_refresh_tokens` tables
- `api/src/platform/apps/OAuthAppService.ts` — `createApp()`, `rotateSecret()`, `getAppByClientId()`
- Raw secret: `crypto.randomBytes(32).toString('hex')`, hashed with `bcrypt` cost 12 before writing to DB
- `POST /api/v1/apps` endpoint — returns `{ client_id, client_secret }` on creation (secret shown once, never again)

**Verify locally:**
```bash
pnpm db:migrate
pnpm test --reporter=verbose api/src/platform/apps

# Create app:
curl -X POST https://ship-web-ak37.onrender.com/api/v1/apps \
  -H "Content-Type: application/json" \
  -d '{"name":"test-app","redirect_uris":["http://localhost:9999/cb"],"scopes":["documents:read"]}'
# Assert: response contains client_id and client_secret (64-char hex string)

# Fetch app — secret must NOT appear:
curl https://ship-web-ak37.onrender.com/api/v1/apps/<id>
# Assert: client_secret absent from response

# Rotate secret:
curl -X POST https://ship-web-ak37.onrender.com/api/v1/apps/<id>/rotate
# Assert: new client_secret returned once
```

**CI gate (`.github/workflows/plugforge.yml`):**
```yaml
- name: Unit tests
  run: pnpm test --run
- name: Migration check
  run: pnpm db:migrate && echo "migrations OK"
```

**Update the workflow:** Add (or update) a job named `m1-oauth-app-registration` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432) so the DB-dependent steps can run. Add the two steps above. If the job already exists, replace its `steps` block with the current definition above.

**Push when:** `POST /api/v1/apps` returns `client_secret` once, `GET /api/v1/apps/:id` does not.

---

### M2 — Public API Boundary + Lint Rule

**What to build:**
- `api/src/platform/api/v1/router.ts` — standalone Express router, imports only from `api/src/platform/`
- Mount in `api/src/app.ts`: `app.use('/api/v1', v1Router)` before all internal routes
- Add to `.eslintrc.json`:
```json
{
  "overrides": [
    {
      "files": ["api/src/platform/api/v1/**"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": ["../../routes/*", "../../services/*"]
        }]
      }
    },
    {
      "files": ["integrations/**"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": ["../../api/src/*"]
        }]
      }
    }
  ]
}
```

**Verify locally:**
```bash
pnpm lint
# Assert: exits 0

# Prove the rule fires — temporarily add a bad import to router.ts:
# import something from '../../routes/documents'
pnpm lint
# Assert: exits non-zero with "no-restricted-imports" error
# Revert the bad import

curl https://ship-web-ak37.onrender.com/api/v1/health
# Assert: 200 { status: 'ok' }

curl https://ship-web-ak37.onrender.com/api/documents
# Assert: still works (internal route unaffected)
```

**CI gate:**
```yaml
- name: Lint (boundary enforcement)
  run: pnpm lint
```

**Update the workflow:** Add (or update) a job named `m2-api-boundary-lint` in `.github/workflows/plugforge.yml`. No DB service needed — lint is pure static analysis. Add the single lint step above.

**Push when:** `pnpm lint` exits 0 and a deliberate cross-boundary import causes it to exit non-zero.

---

### M3 — ApiError Shape + Fitness Test

**What to build:**
- `api/src/platform/errors/ApiError.ts` — `ApiError` class, `ApiErrorCode` union: `"unauthorized" | "forbidden" | "not_found" | "validation_failed" | "rate_limited" | "server_error"`
- `api/src/platform/middleware/requestId.ts` — sets `res.locals.requestId = crypto.randomUUID()` on every request
- `api/src/platform/middleware/errorHandler.ts` — catches `ApiError` + unknown errors, serialises to `{ code, message, details?, request_id }`
- `api/src/platform/__tests__/api-contract.fitness.test.ts` — walks `v1Router.stack`, hits each route without a token, asserts response matches ApiError Zod schema

**Verify locally:**
```bash
pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts

curl https://ship-web-ak37.onrender.com/api/v1/docs
# Assert: { "code": "unauthorized", "message": "...", "request_id": "<uuid>" }

curl https://ship-web-ak37.onrender.com/api/v1/docs -H "Authorization: Bearer invalid"
# Assert: same shape, code: "unauthorized"

# Assert request_id is unique per request:
R1=$(curl -s https://ship-web-ak37.onrender.com/api/v1/docs | jq -r '.request_id')
R2=$(curl -s https://ship-web-ak37.onrender.com/api/v1/docs | jq -r '.request_id')
[ "$R1" != "$R2" ] && echo "PASS" || echo "FAIL"
```

**CI gate:**
```yaml
- name: Fitness test — ApiError shape
  run: pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts
```

**Update the workflow:** Add (or update) a job named `m3-api-error-fitness` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (migrations must have already run). Add the fitness test step above. Set `needs: [m1-oauth-app-registration]` so migrations run first.

**Push when:** fitness test passes with 0 routes missing the ApiError shape on failure paths.

---

### M4 — Bearer Token Middleware + ScopeRegistry

**What to build:**
- `api/src/platform/scopes/ScopeRegistry.ts` — singleton, registers at module load: `documents:read`, `documents:write`, `issues:read`, `issues:write`, `sprints:read`, `sprints:write`, `webhooks:manage`
- `api/src/platform/middleware/bearerAuth.ts` — parses `Authorization: Bearer <token>`, validates against `oauth_access_tokens`, populates `req.auth = { appId, userId, scopes }`. Invalid/missing → 401. Expired → 401 with `details.reason: "token_expired"`.
- `api/src/platform/middleware/requireScope.ts` — factory: `requireScope('documents:read')` returns middleware. Insufficient scope → 403 `{ code: "forbidden", details: { required: "..." } }`
- Wire `bearerAuth` as first middleware on `v1Router`

**Verify locally:**
```bash
pnpm test --run api/src/platform/middleware

# No token:
curl https://ship-web-ak37.onrender.com/api/v1/docs
# Assert: 401, code: "unauthorized"

# Expired token:
curl https://ship-web-ak37.onrender.com/api/v1/docs -H "Authorization: Bearer <expired>"
# Assert: 401, details.reason: "token_expired"

# Wrong scope (documents:read token hitting write route):
curl -X POST https://ship-web-ak37.onrender.com/api/v1/docs \
  -H "Authorization: Bearer <read-only-token>"
# Assert: 403, details.required: "documents:write"

# ScopeRegistry has exactly 7 scopes:
node -e "import('./api/src/platform/scopes/ScopeRegistry.js').then(m => console.log(m.ScopeRegistry.all().length))"
# Assert: 7
```

**CI gate:**
```yaml
- name: Unit tests — middleware
  run: pnpm test --run api/src/platform/middleware
```

**Update the workflow:** Add (or update) a job named `m4-bearer-auth-middleware` in `.github/workflows/plugforge.yml`. Requires a `postgres` service. Add the middleware test step above. Set `needs: [m3-api-error-fitness]`.

**Push when:** all 401/403 variants confirmed, ScopeRegistry returns exactly 7 scopes.

---

### M5 — Documents Resource

**What to build:**
- `api/src/platform/openapi/registerRoute.ts` — attaches `{ operationId, summary, requestSchema, responseSchema, scope }` to a route. All v1 routes use this wrapper.
- `api/src/platform/api/v1/routes/documents.ts`:
  - `GET /api/v1/docs` — scope `documents:read`, returns `{ data: Document[], next_cursor: string | null }`
  - `GET /api/v1/docs/:id` — scope `documents:read`, 404 if missing
  - `POST /api/v1/docs` — scope `documents:write`, Zod-validated body, calls existing `DocumentService`, returns 201
- Delegates to existing `DocumentService` — no domain logic re-implemented

**Verify locally:**
```bash
pnpm test --run api/src/platform/api/v1/routes/documents

curl https://ship-web-ak37.onrender.com/api/v1/docs \
  -H "Authorization: Bearer <documents:read token>"
# Assert: { data: [...], next_cursor: null }

curl https://ship-web-ak37.onrender.com/api/v1/docs/fake-id \
  -H "Authorization: Bearer <token>"
# Assert: 404, code: "not_found"

curl -X POST https://ship-web-ak37.onrender.com/api/v1/docs \
  -H "Authorization: Bearer <documents:write token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"hello"}'
# Assert: 201, body contains id

curl -X POST https://ship-web-ak37.onrender.com/api/v1/docs \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'
# Assert: 400, code: "validation_failed"
```

**CI gate:**
```yaml
- name: Documents resource unit tests
  run: pnpm test --run api/src/platform/api/v1/routes/documents
- name: Fitness test
  run: pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts
```

**Update the workflow:** Add (or update) a job named `m5-documents-resource` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [m4-bearer-auth-middleware]` so prior tasks run first.

**Push when:** all 3 routes covered by unit tests, fitness test still passes.

---

### M6 — OpenAPI 3.1 Spec

**What to build:**
- `api/src/platform/openapi/generator.ts` — walks `v1Router.stack`, reads `registerRoute()` metadata, emits OpenAPI 3.1 JSON at boot
- `GET /api/v1/openapi.json` — serves generated spec, no auth required
- `api/src/platform/__tests__/openapi.test.ts` — generates spec in-process, validates with AJV against the official OpenAPI 3.1 meta-schema

**Verify locally:**
```bash
pnpm test --run api/src/platform/__tests__/openapi.test.ts
# Assert: 0 AJV errors

curl https://ship-web-ak37.onrender.com/api/v1/openapi.json | jq '.openapi'
# Assert: "3.1.0"

curl https://ship-web-ak37.onrender.com/api/v1/openapi.json | jq '.paths | keys'
# Assert: contains "/api/v1/docs" and "/api/v1/docs/{id}"

# Drift check — add a route without registerRoute(), run fitness test:
pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts
# Assert: exits non-zero (route missing spec entry)
# Revert
```

**CI gate:**
```yaml
- name: OpenAPI spec validation
  run: pnpm test --run api/src/platform/__tests__/openapi.test.ts
- name: Fitness test — spec parity
  run: pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts
```

**Update the workflow:** Add (or update) a job named `m6-openapi-spec` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [m5-documents-resource]` so prior tasks run first.

**Push when:** AJV 0 errors, spec parity passes, drift check confirmed.

---

### M7 — SDK Skeleton (`@ship/sdk`)

**What to build:**
- New workspace package `sdk/` — `package.json` name `@ship/sdk`, TypeScript strict
- `sdk/src/ShipClient.ts` — constructor `{ token: string, baseUrl?: string }`
- `sdk/src/resources/MeClient.ts` — `.me()` calls `GET /api/v1/me`, returns typed `User`
- `GET /api/v1/me` on v1 router — user-context tokens only (Client Credentials → 403), returns `{ id, name, email, granted_scopes }`
- `sdk/src/errors.ts` — `ShipError` stub with `kind` discriminant
- `sdk/src/__tests__/ShipClient.integration.test.ts` — starts server, creates test token, asserts `.me()` returns typed user

**Verify locally:**
```bash
pnpm build:sdk && pnpm type-check
# Assert: 0 errors

pnpm test --run sdk/src/__tests__/ShipClient.integration.test.ts
# Assert: me() returns { id, name, email }

node -e "
const { ShipClient } = require('./sdk/dist/index.js');
new ShipClient({ token: 'bad' }).me().catch(e => console.log(e.kind));
"
# Assert: prints "auth"
```

**CI gate:**
```yaml
- name: Build SDK
  run: pnpm build:sdk
- name: SDK integration test
  run: pnpm test --run sdk/src/__tests__/ShipClient.integration.test.ts
- name: Type check
  run: pnpm type-check
```

**Update the workflow:** Add (or update) a job named `m7-sdk-skeleton` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432) (integration test starts the server). Add the steps above. Set `needs: [m6-openapi-spec]` so prior tasks run first.

**Push when:** `.me()` resolves to a typed user, invalid token throws `ShipError { kind: 'auth' }`.

---

### M8 — Regression Gate + Deploy

**What to build:**
- `performance-baseline.json` — committed with Part 1 P95, bundle size, per-route query counts
- CI perf job comparing current metrics against baseline × 1.10
- `api/src/db/seeds/grader-oauth-app.ts` — idempotent, creates read-only OAuth app, prints `client_id` + pre-issued token
- `docs/openapi.json` — static copy of live spec, committed post-deploy

**Verify locally:**
```bash
pnpm test:e2e
# Assert: all green

pnpm test:perf
# Assert: all metrics within +10% of baseline

pnpm db:seed:grader
# Assert: prints client_id and token

TOKEN=<printed token>
curl https://ship-web-ak37.onrender.com/api/v1/docs -H "Authorization: Bearer $TOKEN"
# Assert: 200 { data, next_cursor }
```

**Deploy checklist:**
```bash
./scripts/deploy.sh prod
./scripts/deploy-frontend.sh prod
pnpm db:seed:grader --env prod
curl https://<prod>/api/v1/openapi.json > docs/openapi.json
git add docs/openapi.json && git commit -m "chore: static openapi spec" && git push

# Smoke check:
curl https://<prod>/health
curl https://<prod>/api/v1/openapi.json | jq '.openapi'
# Assert: "3.1.0"
```

**CI gate:**
```yaml
- name: E2E regression suite
  run: pnpm test:e2e
- name: Performance regression check
  run: pnpm test:perf
```

**Update the workflow:** Add (or update) a job named `m8-regression-gate` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) before the E2E step. Add the steps above. Set `needs: [m7-sdk-skeleton]` so prior tasks run first.

**Push when:** E2E green, perf within budget, grader token confirmed on prod.

---

## Section 2 — Final Submission

> All MVP tasks complete first. Deadline: Sunday 11:59 AM CT.
> Work top to bottom — tasks build on each other.

---

### F1 — Auth Code + PKCE Full Flow

**What to build:**
- `api/src/platform/oauth/authorize.ts` — `GET /oauth/authorize` renders consent screen; `POST /oauth/authorize` stores auth code with `code_challenge`, redirects with `?code=`
- `api/src/platform/oauth/token.ts` — `POST /oauth/token` for `grant_type=authorization_code`: verifies `BASE64URL(SHA256(code_verifier)) === code_challenge`. Mismatch → 400 `{ error: "invalid_grant" }`. Codes are single-use.
- `e2e/oauth-pkce.spec.ts` — Playwright test covering happy path AND wrong-verifier negative case (both mandatory per PRD)

**Verify locally:**
```bash
pnpm test:e2e --grep "PKCE"
# Assert: both happy path and wrong-verifier cases pass

# Manual wrong-verifier check (MANDATORY):
curl -X POST https://ship-web-ak37.onrender.com/oauth/token \
  -d "grant_type=authorization_code&code=<code>&code_verifier=wrong"
# Assert: 400, error: "invalid_grant"

# Timing:
time curl -X POST https://ship-web-ak37.onrender.com/oauth/token ...
# Assert: < 3s
```

**CI gate:**
```yaml
- name: OAuth PKCE E2E (happy path + negative case)
  run: pnpm test:e2e --grep "PKCE"
```

**Update the workflow:** Add (or update) a job named `f1-oauth-pkce` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) before the E2E step. Add the steps above. Set `needs: [m8-regression-gate]` so prior tasks run first.

**Push when:** Playwright test green — both happy path and wrong-verifier pass.

---

### F2 — Device Authorization Grant

**What to build:**
- `POST /oauth/device/code` → `{ device_code, user_code, verification_uri, expires_in: 900, interval: 5 }`
- `GET /oauth/device` — form page + consent screen
- `POST /oauth/token` with device grant type — returns `authorization_pending`, `slow_down` (on fast poll), or tokens
- `e2e/oauth-device.spec.ts` — Playwright test including slow_down behavior

**Verify locally:**
```bash
curl -X POST https://ship-web-ak37.onrender.com/oauth/device/code \
  -d "client_id=<id>&scope=documents:read"
# Assert: user_code, device_code, verification_uri, interval: 5

curl -X POST https://ship-web-ak37.onrender.com/oauth/token \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=<code>"
# Assert: { error: "authorization_pending" }

# Poll twice quickly:
# Assert second: { error: "slow_down" }

# After browser approval + final poll:
curl https://ship-web-ak37.onrender.com/api/v1/me -H "Authorization: Bearer <access_token>"
# Assert: 200 { id, name, email }

pnpm test:e2e --grep "device flow"
```

**CI gate:**
```yaml
- name: Device Authorization Grant E2E
  run: pnpm test:e2e --grep "device flow"
```

**Update the workflow:** Add (or update) a job named `f2-device-grant` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) before the E2E step. Add the steps above. Set `needs: [f1-oauth-pkce]` so prior tasks run first.

**Push when:** full polling loop works, slow_down honored, token passes `/api/v1/me`.

---

### F3 — Refresh Token Rotation + Stolen Token Detection

**What to build:**
- `oauth_refresh_tokens` schema: add `family_id`, `used_at`
- On refresh exchange: issue new pair, mark old `used_at = now()`
- On reuse (already `used_at`): revoke entire `family_id` → 400 `{ error: "invalid_grant" }`

**Verify locally:**
```bash
pnpm test --run api/src/platform/oauth/refresh.test.ts

# Exchange refresh token → get new pair
# Reuse OLD refresh token:
curl -X POST https://ship-web-ak37.onrender.com/oauth/token \
  -d "grant_type=refresh_token&refresh_token=<old_token>"
# Assert: 400, error: "invalid_grant"

# New access token must now be rejected (family killed):
curl https://ship-web-ak37.onrender.com/api/v1/me \
  -H "Authorization: Bearer <new_access_token>"
# Assert: 401
```

**CI gate:**
```yaml
- name: Refresh token rotation unit tests
  run: pnpm test --run api/src/platform/oauth/refresh.test.ts
```

**Update the workflow:** Add (or update) a job named `f3-refresh-token-rotation` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f2-device-grant]` so prior tasks run first.

**Push when:** family revocation confirmed — new access token rejected after reuse of old refresh token.

---

### F4 — Webhook Pipeline (Event Bus → Signer → Deliverer)

**What to build:**
- `api/src/platform/events/IEventBus.ts` + `InMemoryEventBus.ts`
- Event Zod schemas: `document.created/updated/deleted`, `issue.created/assigned/status_changed`, `sprint.started/completed`
- Publish in `DocumentService.create/update/delete` — domain layer only
- Migration `059_webhook_subscriptions.sql`
- `POST /api/v1/webhooks` (scope: `webhooks:manage`) — returns `{ id, signing_secret }` once
- `HmacSigner.ts` — signs `t=<unix>.<rawBody>`, header: `Ship-Signature: t=<unix>,v1=<hex>`
- `InMemoryWebhookDeliverer.ts` — matches subscriptions, signs, `fetch(targetUrl)`

**Verify locally:**
```bash
pnpm test --run api/src/platform/webhooks

# Start listener on port 9001, create doc, assert signed POST arrives within 2s
# Verify signature with verifyWebhook() → assert true
# Tamper body → assert false
```

**CI gate:**
```yaml
- name: Webhook pipeline unit tests
  run: pnpm test --run api/src/platform/webhooks
- name: Webhook E2E (delivery within 2s)
  run: pnpm test:e2e --grep "webhook delivery"
```

**Update the workflow:** Add (or update) a job named `f4-webhook-pipeline` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) for the E2E step. Add the steps above. Set `needs: [f3-refresh-token-rotation]` so prior tasks run first.

**Push when:** signed delivery within 2s confirmed, tampered body rejected.

---

### F5 — Retry, DLQ, Delivery Log, Replay

**What to build:**
- Migration `060_webhook_deliveries.sql` — `webhook_deliveries` with `attempt_number`, `response_status`, `latency_ms`, `idempotency_key`, `dead_lettered_at`
- `IClock.ts` + `WallClock.ts` + `FakeClock.ts` — no `setTimeout` in tests
- Retry schedule `[1s, 4s, 16s, 1m, 5m, 30m]` ±10% jitter. 5xx → retry. 4xx (except 429) → dead-letter. 6 failures → `dead_lettered_at`.
- `GET /api/v1/webhooks/deliveries` — paginated
- `POST /api/v1/webhooks/deliveries/:id/replay` — re-fires with original `idempotency_key`

**Verify locally:**
```bash
pnpm test --run api/src/platform/webhooks/retry.test.ts
# Assert: runs in < 1s (FakeClock)

# Check delivery log after 3 failures + 1 success:
curl https://ship-web-ak37.onrender.com/api/v1/webhooks/deliveries \
  -H "Authorization: Bearer <token>" | jq '.data | length'
# Assert: 4 rows, statuses 500 500 500 200

# Force 6 failures, confirm DLQ entry, replay, confirm same idempotency_key
```

**CI gate:**
```yaml
- name: Retry + DLQ unit tests (must complete in < 5s)
  run: pnpm test --run api/src/platform/webhooks/retry.test.ts
  timeout-minutes: 1
- name: Delivery log + replay E2E
  run: pnpm test:e2e --grep "retry|dead.letter|replay"
```

**Update the workflow:** Add (or update) a job named `f5-retry-dlq-replay` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) for the E2E step. Add the steps above. Set `needs: [f4-webhook-pipeline]` so prior tasks run first.

**Push when:** retry test < 1s, DLQ confirmed, replay preserves idempotency key.

---

### F6 — Rate Limiting + Audit Trail

**What to build:**
- `TokenBucketLimiter.ts` — in-memory per-app (1000 req/min), implements `IRateLimiter`
- `rateLimit.ts` middleware — `X-RateLimit-Limit/Remaining/Reset` on every response. 429 + `Retry-After` on exceed.
- Migration `061_audit_log.sql` — `public_api_audit` with `client_id`, `user_id` (nullable), `route`, `scope_used`, `http_status`, `latency_ms`, `request_id`
- `auditLog.ts` middleware — writes row after every `/api/v1/*` response including 401/403

**Verify locally:**
```bash
pnpm test --run api/src/platform/ratelimit api/src/platform/audit

curl -i https://ship-web-ak37.onrender.com/api/v1/docs -H "Authorization: Bearer <token>" | grep -i "x-ratelimit"
# Assert: all 3 headers present

# Trigger 429 (set limit to 5 in test env, fire 6 requests)
# Assert: 6th returns 429 with Retry-After

psql $DATABASE_URL -c "SELECT route, scope_used, http_status FROM public_api_audit ORDER BY created_at DESC LIMIT 1;"
# Assert: row present after each API call
```

**CI gate:**
```yaml
- name: Rate limit + audit unit tests
  run: pnpm test --run api/src/platform/ratelimit api/src/platform/audit
- name: Fitness test — headers on 100% of routes
  run: pnpm test --run api/src/platform/__tests__/api-contract.fitness.test.ts
```

**Update the workflow:** Add (or update) a job named `f6-ratelimit-audit` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f5-retry-dlq-replay]` so prior tasks run first.

**Push when:** all 3 rate-limit headers on every response, audit row confirmed.

---

### F7 — Full SDK + `verifyWebhook` + Typed Errors

**What to build:**
- `DocumentsClient.ts` — `.list()`, `.get()`, `.create()`, `.iterate()` (async generator, pagination internal)
- `IssuesClient.ts`, `SprintsClient.ts`, `WebhooksClient.ts`
- `DeviceFlow.ts`, `AuthorizationCodeFlow.ts`, `ITokenStore.ts` (in-memory, file, localStorage)
- `verifyWebhook(headers, rawBody, secret, toleranceSec = 300): boolean`
- `ShipError` union: `kind: 'auth' | 'rate_limit' | 'not_found' | 'validation' | 'server'`
- `openapi-parity.test.ts` — fetches spec, asserts every path+method has SDK method

**Verify locally:**
```bash
pnpm build:sdk && pnpm type-check

pnpm test --run sdk/src/__tests__
pnpm test --run sdk/src/__tests__/openapi-parity.test.ts
# Assert: 0 drift

# verifyWebhook speed:
node -e "
const { verifyWebhook } = require('./sdk/dist/index.js');
const t = Date.now();
for (let i = 0; i < 1000; i++) verifyWebhook({}, '', 'secret');
console.log((Date.now()-t)/1000 + 'ms avg');
"
# Assert: < 1ms

pnpm size-limit
# Assert: < 250 KB gzipped
```

**CI gate:**
```yaml
- name: SDK build + type check
  run: pnpm build:sdk && pnpm type-check
- name: SDK tests + parity
  run: pnpm test --run sdk/src/__tests__
- name: SDK size limit
  run: pnpm size-limit
```

**Update the workflow:** Add (or update) a job named `f7-sdk-full` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f6-ratelimit-audit]` so prior tasks run first.

**Push when:** parity 0 drift, `verifyWebhook` < 1ms, size < 250KB.

---

### F8 — CLI Tool (`ship` binary)

**What to build:**
- `integrations/cli/` — `bin: { "ship": "./dist/index.js" }`, uses `commander`, imports only `@ship/sdk`
- `ship login` — device flow, stores token to `~/.ship/token.json`
- `ship docs ls` / `ship docs create --title "..."` — list and create via SDK
- `ship webhooks tail` — SSE stream, prints each delivery with `✓ verified` / `✗ invalid`

**Verify locally:**
```bash
pnpm build:cli

rm -f ~/.ship/token.json
ship docs ls
# Assert: "Not logged in. Run: ship login"

ship login
# Assert: prints user_code and URL, "Logged in as <name>" after approval

ship docs create --title "CLI test"
# Assert: prints document id

ship docs ls
# Assert: "CLI test" in list

ship webhooks tail &
ship docs create --title "tail test"
sleep 3
# Assert: event printed with "✓ verified"

pnpm lint integrations/cli
# Assert: exits 0 (no api/src imports)
```

**CI gate:**
```yaml
- name: CLI build
  run: pnpm build:cli
- name: CLI lint (no api/src imports)
  run: pnpm lint integrations/cli
- name: CLI integration tests
  run: pnpm test --run integrations/cli/tests
```

**Update the workflow:** Add (or update) a job named `f8-cli` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f7-sdk-full]` so prior tasks run first.

**Push when:** login → docs create → webhooks tail full loop confirmed.

---

### F9 — TTFE Drill Harness

**What to build:**
- `integrations/cli/tests/ttfe.drill.ts` — vitest test: device login → subscribe → create doc → wait for signed delivery → verify. Lower-bound assertion: `expect(elapsed).toBeGreaterThan(50)` prevents fake listener passing silently.
- `SHIP_DEVICE_CODE` env var for CI auto-approval (no browser in CI)
- Writes `test-results/ttfe-timing.json` with 6 stage timings

**Verify locally:**
```bash
pnpm drill ttfe
# Assert: exits 0, total elapsed < 60000ms

cat test-results/ttfe-timing.json | jq '[.[].elapsedMs] | add'
# Assert: < 60000 and all individual stages > 50ms

# Run 5 times, assert 0 failures:
for i in $(seq 1 5); do pnpm drill ttfe || echo "FAILED run $i"; done
```

**CI gate:**
```yaml
- name: TTFE drill
  run: pnpm drill ttfe
  timeout-minutes: 2
- name: TTFE elapsed check
  run: |
    TOTAL=$(cat test-results/ttfe-timing.json | jq '[.[].elapsedMs] | add')
    [ "$TOTAL" -lt 60000 ] || (echo "TTFE exceeded 60s: ${TOTAL}ms" && exit 1)
```

**Update the workflow:** Add (or update) a job named `f9-ttfe-drill` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Pass `SHIP_DEVICE_CODE: ${{ secrets.SHIP_DEVICE_CODE }}` as an env var on the drill step for CI auto-approval. Add the steps above. Set `needs: [f8-cli]` so prior tasks run first.

**Push when:** 5 consecutive local passes, < 60s, lower-bound check present.

---

### F10 — Developer Portal UI

**What to build:**
- `web/src/pages/developer/` — AppsPage, AppDetailPage (shown-once `<dialog>` for secret), SubscriptionsPage, DeliveryLogPage (Dead Letters tab + Replay), AuditLogPage
- Route `/developer` in React router. All pages call `/api/v1/` only.

**Verify locally:**
```bash
pnpm dev
# /developer — register app → modal shows secret → close → secret gone
# Rotate secret → new secret in modal
# Delivery Log → table + DLQ tab → Replay → new row

pnpm test:e2e --grep "developer portal"
```

**CI gate:**
```yaml
- name: Developer portal E2E
  run: pnpm test:e2e --grep "developer portal"
```

**Update the workflow:** Add (or update) a job named `f10-developer-portal` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Requires Playwright browsers (`pnpm exec playwright install --with-deps chromium`) before the E2E step. Add the steps above. Set `needs: [f9-ttfe-drill]` so prior tasks run first.

**Push when:** register → rotate → delivery log → DLQ → replay all pass E2E.

---

### F11 — Agent Rewire (Epic 7)

**What to build:**
- Migration `062_agent_oauth_app_seed.sql` — seeds FleetGraph system user `{ name: "FleetGraph", email: "fleetgraph@ship.internal" }` + OAuth app. Client Credentials tokens carry `user_id = fleetgraph_system_user.id` (never null).
- `AGENT_USE_PUBLIC_API=true` env var in FleetGraph composition root
- Flag ON: replace `pool.query()` with `@ship/sdk` calls. Flag OFF: original path unchanged.

**Verify locally:**
```bash
AGENT_USE_PUBLIC_API=false pnpm test --run api/src/__tests__/fleetgraph
# Assert: all pass

AGENT_USE_PUBLIC_API=true pnpm test --run api/src/__tests__/fleetgraph
# Assert: all pass

# Audit proof:
psql $DATABASE_URL -c "
  SELECT client_id, user_id, route FROM public_api_audit
  WHERE client_id = (SELECT client_id FROM oauth_apps WHERE name = 'FleetGraph')
  ORDER BY created_at DESC LIMIT 5;
"
# Assert: rows present, user_id not null, zero rows with client_id = null
```

**CI gate:**
```yaml
- name: FleetGraph tests — flag OFF
  run: AGENT_USE_PUBLIC_API=false pnpm test --run api/src/__tests__/fleetgraph
- name: FleetGraph tests — flag ON
  run: AGENT_USE_PUBLIC_API=true pnpm test --run api/src/__tests__/fleetgraph
- name: Audit trail proof
  run: pnpm test --run api/src/__tests__/agent-audit-proof.test.ts
```

**Update the workflow:** Add (or update) a job named `f11-agent-rewire` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f10-developer-portal]` so prior tasks run first.

**Push when:** both flag states pass, audit rows confirm FleetGraph client_id with non-null user_id.

---

### F12 — Reference Integrations (choose ≥ 4 beyond CLI)

**F12a — Refresh Token Rotation Drill**
```bash
pnpm drill stolen-token
# Assert: exits 0, family revocation confirmed
```

**F12b — Idempotency-Key Drill**
```bash
pnpm drill idempotency
# Assert: same Idempotency-Key on both replay subscriber POSTs
```

**F12c — Browser SDK Demo (PKCE SPA)**
```bash
cd integrations/browser-demo && pnpm dev
pnpm test:e2e --grep "browser demo"
# Assert: login → documents list renders
```

**F12d — Slack Integration**
```bash
pnpm test --run integrations/slack/tests
# Assert: document.created posts to channel, tampered signature → 400
```

**CI gate:**
```yaml
- name: Reference drills
  run: pnpm drill stolen-token && pnpm drill idempotency
- name: Slack integration tests
  run: pnpm test --run integrations/slack/tests
```

**Update the workflow:** Add (or update) a job named `f12-reference-integrations` in `.github/workflows/plugforge.yml`. Requires a `postgres` service (image `postgres:16`, port 5432). Add the steps above. Set `needs: [f11-agent-rewire]` so prior tasks run first.

---

### F13 — Architecture Document

**What to build:**
- `docs/architecture.md` — 9 sections with Mermaid diagrams for boundary, OAuth flows, webhook pipeline, agent before/after

**Verify locally:**
```bash
grep -c "^##" docs/architecture.md
# Assert: >= 9

grep "api/src/platform" docs/architecture.md | wc -l
# Assert: >= 5 (SOLID file path references)
```

**CI gate:**
```yaml
- name: Architecture doc check
  run: |
    [ -f docs/architecture.md ] || (echo "missing" && exit 1)
    COUNT=$(grep -c "^##" docs/architecture.md)
    [ "$COUNT" -ge 9 ] || (echo "only $COUNT sections" && exit 1)
```

**Update the workflow:** Add (or update) a job named `f13-architecture-doc` in `.github/workflows/plugforge.yml`. No DB service needed. Add the steps above. Set `needs: []` — this job depends only on checkout and can run standalone.

---

### F14 — Final Submission Checklist

```bash
# Repo public:
gh repo view --json isPrivate | jq '.isPrivate'
# Assert: false

# OpenAPI live + static:
curl https://<prod>/api/v1/openapi.json | jq '.openapi'
ls docs/openapi.json

# Grader token works on prod:
curl https://<prod>/api/v1/docs -H "Authorization: Bearer <grader_token>"
# Assert: 200 { data, next_cursor }

# TTFE passing in CI:
gh run list --workflow=plugforge.yml --limit=1 --json conclusion | jq '.[0].conclusion'
# Assert: "success"

# Required docs committed:
ls docs/architecture.md docs/openapi.json docs/presearch.md docs/epics/

# Tag release:
git tag -a v1.0.0-plugforge -m "Final submission"
git push origin v1.0.0-plugforge
```

**Demo script (record this for the video):**
```bash
cd /tmp && mkdir demo && cd demo
pnpm install @ship/sdk
ship login                          # Device flow — show code, approve in browser
ship docs create --title "hello"    # Creates via SDK + public API
ship webhooks tail                  # Events stream — document.created ✓ verified
# Switch to browser → /developer → replay one DLQ delivery
```
