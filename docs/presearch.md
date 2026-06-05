# Pre-Search Document — Ship PlugForge

> Completed before writing code, per PRD requirement.
> All three phases are answered below. This document plus the AI conversation log constitute the pre-search artifact.

---

## Pre-Search Phase 1 — Constraints

### 1.1 Scale & Load Expectations

**Demo-window API rate:** One grader session ≈ 20–50 req/min. The in-memory token bucket (1 000 req/min default) comfortably handles this; no Redis needed for demo.

**Webhook fanout ratio:** Each write event (document.created, issue.assigned, etc.) fans out to N matching subscriptions. For demo, seed 2–3 subscriptions per event type, so fanout ≤ 3 per write. The in-memory deliverer handles this synchronously without backpressure.

**Delivery log row growth:** At demo volume (≈ 50 events × 3 subscriptions × up to 6 retry attempts) = ~900 rows maximum per demo run. Negligible. Retention window = 30 days (configurable via `WEBHOOK_DELIVERY_RETENTION_DAYS`).

**Concurrent Device Flow sessions:** Demo = 1–3 concurrent CLI sessions. Polling interval = 5s; slow_down bumps interval to 10s. No concurrency issue with in-memory device code store.

**In-memory deliverer headroom:** Drops below the < 2s P95 target at approximately 100+ concurrent deliveries per second. Well above demo load. Document this ceiling explicitly in `docs/architecture.md`.

---

### 1.2 Budget & Cost Ceilings

**CI minutes per PR:** Each PR runs:
- TTFE drill: ~15–30s
- OAuth Playwright flow (2 flows × ~10s): ~20s
- Full Vitest suite: ~30s
- Total per PR: ≈ 90s — budget at 3 min/PR, ~$0.005/PR on GitHub Actions.

**SDK install footprint:** Target < 250 KB minified + gzipped (PRD hard limit). Enforce with a `size-limit` check in CI (`package.json` `size-limit` field). Zero heavy runtime deps — no axios, no lodash.

**Webhook queue runaway ceiling:** In-memory deliverer: cap the in-flight queue at 500 pending deliveries. Beyond that, new deliveries are dead-lettered immediately with `reason: "queue_full"`. Prevents unbounded memory growth during demo.

**LLM spend (Epic 7 rewire):** Zero additional LLM tokens — the rewire replaces direct service calls with SDK calls, same agent logic. Verify with a before/after token count assertion in the agent test suite.

---

### 1.3 Timeline & Scope Reality

**Must-ship epics (non-negotiable) — PRD Epic numbering:**
- Epic 1: Auth Code + PKCE (tasks: E1)
- Epic 2: Device Authorization Grant (tasks: E2)
- Epic 3: Public API boundary + bearer middleware (tasks: M2, M4)
- Epic 4: Documents resource + OpenAPI spec (tasks: M5, M6)
- Epic 5: SDK skeleton → full SDK (tasks: M7, E10)
- Epic 6: CLI — `ship login`, `ship docs create`, `ship webhooks tail` (tasks: E11)
- Epic 7: Webhooks end-to-end + agent rewire (tasks: E6, E7, F4)

**Should-ship (cut if time-constrained):**
- Developer portal UI — minimum viable = read-only delivery log view (tasks: F3)
- Refresh token rotation drill (tasks: E3)
- Slack integration (tasks: F6d)

**Kill criterion for developer portal:** If the full portal takes more than 4 hours, ship a read-only delivery log view at `/developer` — one table, no forms. The portal "eats its own dog food" requirement is still satisfied by a read-only view.

**Day-by-day sketch (references PLUGFORGE-TASKS.md task IDs):**
- Day 1: M1–M4 (OAuth foundation + boundary + error shape + bearer middleware)
- Day 2: M5–M8 (documents resource, OpenAPI, SDK skeleton, deploy)
- Day 3: E1–E3 (full PKCE flow, device flow, refresh rotation)
- Day 4: E4–E6 (remaining resources, webhooks pipeline end-to-end)
- Day 5: E7–E11 (retry/DLQ, rate limit, audit, full SDK, CLI)
- Day 6: F1–F3 (TTFE drill, SSE tail, portal)
- Day 7: F4–F7 (agent rewire, architecture docs, submission)

---

### 1.4 Security & Data Sensitivity

**`client_secret` at rest:** bcrypt, cost factor 12, random salt per secret. Not recoverable — only rotation creates a new one. The raw secret is returned in the API response body exactly once and never logged.

**Access token TTL:** 15 minutes. Refresh token TTL: 90 days. Refresh tokens are single-use with rotation (Task E3).

**Stolen refresh token detection:** On reuse of a consumed refresh token, the entire `family_id` is invalidated. All access tokens issued from that family become invalid on their next use (checked at bearer validation time via a `revoked_families` set in the token store).

**Webhook payload content:** Ship only the event metadata + document/issue ID, not the full document content. Rationale: reduces exposure surface; subscribers fetch content on demand via the SDK if needed. Document this decision in `docs/architecture.md`.

**Developer portal secret display:** The shown-once modal uses a `<dialog>` element with `autofocus` on the "Copy" button. The secret is served in the POST response body only — never in a GET response, never in a URL, never in a log line. The modal sets `data-secret` only in memory (React state), not in the DOM after close.

**CSRF protection:** The developer portal form endpoints (app registration, secret rotation) are called with the session cookie + a CSRF token (existing Ship `csrf-sync` middleware). The OAuth consent screen (`/oauth/authorize POST`) is exempt from CSRF because it uses `state` parameter validation per RFC 6749 §10.12. The consent screen sets `X-Frame-Options: DENY` to prevent clickjacking.

---

### 1.5 Team Skill Inventory

- OAuth 2.0 consumed before, implementing from scratch — read RFC 6749 + 7636 + 8628 on Day 1 morning before touching E1.
- Zod + `@asteasolutions/zod-to-openapi` — new dependency; fallback is `zod-to-openapi` package if the Asteasolutions one breaks.
- SDK design — hand-written for type quality, fitness-tested for parity drift. Async-iterator pagination modeled after the `@anthropic-ai/sdk` page iterator pattern.

---

## Pre-Search Phase 2 — Architecture Decisions

### 2.1 OAuth Flow Choices

| Decision | Choice | Rationale |
|---|---|---|
| Refresh tokens from day one | Yes | Migration cost is high if added later — token table schema must support `family_id` from the start |
| Scope upgrades | No incremental consent | Re-consent required for new scopes. Simpler model; acceptable for demo week |
| Consent screen location | Route inside Ship's UI at `/oauth/authorize` | Reuses existing session auth; minimal new surface. Protected by `X-Frame-Options: DENY` |
| Device Grant verification UX | User pastes code into a form at `/oauth/device` | RFC 8628 allows both; form is simpler to implement and test than auto-approving a URL-embedded code |
| Agent OAuth grant type | Client Credentials (RFC 6749 §4.4) | Agent is a first-party server-side process — no human in the loop, no browser. Client Credentials is the correct M2M flow |
| Agent app seeding | Migration `062_agent_oauth_app_seed.sql` | Guaranteed present in all environments including prod deploys. Not a runtime seed script |

---

### 2.2 Public API Shape

| Decision | Choice | Rationale |
|---|---|---|
| Error shape consistency | One shape across all routes, `details` may be richer | Fitness test asserts the base keys on every route; `details` is `Record<string, unknown>` so routes can add context without breaking the contract |
| Field-level filtering | Skip for the week | YAGNI — adds spec complexity for zero demo value |
| Versioning policy past `/v1/` | Additive changes only in `/v1/`; breaking changes via `/v2/` | Document in `docs/architecture.md` and the OpenAPI spec `info.description` |
| Cursor pagination scope | All list endpoints except `/api/v1/scopes` (static list of 7 items) | Fitness test knows: routes tagged `list: true` in `registerRoute()` must return `{ data, next_cursor }` |
| `/api/v1/me` token requirement | User-context tokens only (Auth Code or Device Grant). Client Credentials tokens receive 403. | Machine tokens have no user identity. FleetGraph never calls `/me` — it knows its own identity. Documented in OpenAPI spec. |

---

### 2.3 Webhook Reliability

| Decision | Choice | Rationale |
|---|---|---|
| What is signed | `t=<unix>` + `.` + raw JSON body string | Same scheme as Stripe. Concatenation prevents length-extension attacks; timestamp prevents replay |
| 4xx vs 5xx permanence | 4xx = permanent (except 429), 5xx = transient, 429 = transient (subscriber overloaded) | 410 Gone is permanent. 429 is transient — subscriber is alive but busy |
| Retry schedule testing | `IClock` interface injected into deliverer | `FakeClock` in tests advances time deterministically. Zero `setTimeout` in test code |
| Idempotency-Key origin | Generated at first delivery attempt as `crypto.randomUUID()`. Carried on replays unchanged | Contract for subscribers: same key = same event. Document deduplication window as subscriber's responsibility |
| Delivery semantics | At-least-once | Simpler than exactly-once; idempotency key gives subscribers the tool to dedupe |

---

### 2.4 SDK Design

| Decision | Choice | Rationale |
|---|---|---|
| Generated vs. hand-written | Hand-written, parity-tested against spec | Generated SDKs from OpenAPI have poor TypeScript ergonomics (no async iterators, weak discriminated unions). Fitness test catches drift without giving up quality |
| Error model | Typed discriminated union (`ShipError`) | Most TypeScript-native — `switch (e.kind)` exhaustively handles all cases. No Result-type wrapper (adds friction for most consumers) |
| Pagination | Async-iterator only | Cleaner consumer API. Raw cursor access available via `.list()` if needed for advanced use cases |
| `ITokenStore` contract | Stores both access and refresh tokens. Single mutex for refresh under concurrent calls | Prevents thundering-herd refresh: first concurrent caller holds the lock, rest wait and receive the new token |

---

### 2.5 Developer Portal

| Decision | Choice | Rationale |
|---|---|---|
| Public API or internal endpoint | Public API only (`/api/v1/`) | Eats own dog food — proves the API surface is complete. No internal escape hatch |
| `client_secret` rotation model | Old secret immediately invalidated on rotation | Stripe does a grace period; we skip it for simplicity. Document the "rotate and redeploy immediately" operational requirement |
| Delivery log scale | Server-side cursor pagination via the existing `GET /api/v1/webhooks/deliveries` | Build-cheap. Virtualized list is rebuild-cheap later if needed |
| Webhook payload display | ID + event type only, no payload body | Consistent with the webhook payload decision in §1.4. Reduces leakage surface |

---

### 2.6 Agent-as-Citizen Rewire

| Decision | Choice | Rationale |
|---|---|---|
| OAuth grant type | Client Credentials (`grant_type=client_credentials`) | Agent is server-side, non-interactive, first-party. No PKCE dance needed |
| Agent app seeding | Migration `062_agent_oauth_app_seed.sql` — seeds both the OAuth app AND a system user `{ name: "FleetGraph", email: "fleetgraph@ship.internal" }` | Client Credentials tokens issued to the agent app carry `user_id = system_user.id`. Comments, audit rows, and `created_by` fields show "FleetGraph" — no null authorship, no UI changes needed. |
| Agent scopes | `documents:read`, `documents:write`, `issues:read`, `issues:write` | Minimum necessary. No `webhooks:manage` — agent does not manage subscriptions |
| Feature flag | `AGENT_USE_PUBLIC_API=true` env var, checked at agent service composition root | Both paths tested in CI. Flag off = Part 2 tests unchanged. Flag on = audit log proof |
| CI proof | Run agent test suite with flag on, grep `public_api_audit` for agent `client_id` rows | Zero rows with `client_id = null` after an agent turn proves no internal bypass |

---

## Pre-Search Phase 3 — Post-Stack Refinement

### 3.1 Security & Failure Modes

| Failure | Response |
|---|---|
| OAuth app owner deleted | App set to `deactivated = true`. All tokens for that app rejected at bearer validation. No orphan tokens remain active |
| Webhook deliverer crashes mid-batch | In-memory deliverer: deliveries in flight are lost. At-least-once guarantee means they are NOT retried automatically after restart (in-memory state gone). Document: production upgrade path is BullMQ + Redis, which survives restarts |
| Leaked `client_secret` | Owner rotates via portal. Old hash immediately invalidated. Audit log entry with `event: secret_rotated` is the alert signal |
| CSRF on portal forms | `csrf-sync` middleware already in Ship. Portal forms include `X-CSRF-Token` header. OAuth consent screen uses `state` parameter validation instead |
| OpenAPI generator throws at boot | Wrapped in a try/catch in `app.ts`. On failure: server boots but `GET /api/v1/openapi.json` returns 503 with `{ code: "server_error", message: "OpenAPI spec unavailable" }`. CI fitness test catches this before deploy |

---

### 3.2 Testing Strategy

| Concern | Approach |
|---|---|
| OAuth Playwright test stability | Ship runs its own auth — no external IdP. Tests run against the local Express server. No Keycloak/Auth0 stub needed. Playwright launches a real browser against the dev server |
| Webhook retry schedule without sleeping | `IClock` interface on the deliverer. `FakeClock.advance(ms)` in tests. Retry loop calls `clock.now()` instead of `Date.now()` |
| TTFE drill in CI | `SHIP_DEVICE_CODE` env var set by `onUserCode` callback. Server auto-approves device codes matching this env var. No browser needed in CI for the device flow |
| OpenAPI fitness test CI wiring | Fail the build on any drift. Additive changes (new route registered but missing spec entry) = build failure. No "warn and post diff" — contract discipline requires hard failure |
| +10% regression budget | `performance-baseline.json` committed to repo. CI job runs the full E2E suite and compares P95, bundle size (`webpack-bundle-analyzer` or Vite's `--report`), and per-route query counts (existing `query-audit` middleware). Fails PR if any metric exceeds baseline × 1.10 |

---

### 3.3 Tooling & CI

**Boundary lint rules (two rules, both required):**
1. `no-restricted-imports` in `api/src/platform/api/v1/**`: forbids importing from `../../routes/**` and `../../services/**`.
2. `no-restricted-imports` in `integrations/**`: forbids importing from `../../api/src/**`. Only `@ship/sdk` allowed.

Both rules added to `.eslintrc.json` (or `eslint.config.js`) before any cross-imports exist. Enforced in the `pnpm lint` CI step.

**CI job order:**
```
lint → type-check → unit tests → build → OpenAPI fitness → TTFE drill → Playwright E2E → performance regression check
```

Each step is a prerequisite for the next. The TTFE drill runs after build so the CLI is compiled.

---

### 3.4 Deployment & Hosting

**Deployed instance:** Elastic Beanstalk (existing Ship deployment via `./scripts/deploy.sh prod`).

**Grader access:** A post-deploy seed script creates one read-only OAuth app (`documents:read`, `issues:read`) and prints the `client_id` and a pre-issued access token. These go into the `README.md` under "Grader Credentials". The seed script is idempotent — running it twice is safe.

**OpenAPI spec:** Served live at `/api/v1/openapi.json`. Static copy at `docs/openapi.json` generated via `curl <prod>/api/v1/openapi.json > docs/openapi.json` post-deploy and committed. A Redoc or Swagger UI page at `/api/v1/docs` (HTML, no auth) is a nice-to-have.

**One-command CLI setup for graders:**
```bash
npx @ship/sdk  # or: npm install -g @ship/sdk (once published)
ship login     # device flow against the prod instance
```
Documented in `README.md` under "Quick Start".

---

### 3.5 Observability of API Usage

**Per-call metrics recorded in `public_api_audit`:** `route`, `method`, `http_status`, `scope_used`, `client_id`, `user_id`, `latency_ms`, `request_id`, `created_at`.

**Agent citizen proof:** After a demo agent turn with `AGENT_USE_PUBLIC_API=true`:
- Portal Audit tab shows rows with the agent's `client_id`.
- A CI fitness test runs the agent, then queries `public_api_audit` and asserts `COUNT(*) WHERE client_id = :agent_client_id > 0`.

**Idempotency-Key observability:** `webhook_deliveries.idempotency_key` column. Portal delivery log shows the key per row. Subscriber dedupe is detectable by filtering delivery log rows by `idempotency_key` — if the subscriber processed the key correctly, only one row should show a non-retried delivery.

---

---

## Three Discoveries

### 1. OAuth Device Authorization Grant in TypeScript (RFC 8628)

Implementing Device Grant from scratch exposed a subtlety: the `slow_down` response is not a rate-limit error — it's a signal to the client to permanently increase its polling interval for this session. Most tutorials conflate it with `authorization_pending`. The correct behavior: on `slow_down`, the client adds 5 seconds to its interval and never goes back down. This is enforced in `sdk/src/auth/DeviceFlow.ts` where the polling interval is a mutable local variable, not a constant.

The other surprise: RFC 8628 §6.3 permits embedding the `user_code` directly in a clickable URL (`verification_uri_complete`). We implemented the form-entry flow first (simpler to test) and documented `verification_uri_complete` as a follow-up.

### 2. Zod-Driven OpenAPI Generation with Fitness-Test Parity

The `@asteasolutions/zod-to-openapi` approach flips the conventional workflow: instead of writing an OpenAPI spec and generating types from it, route handlers declare their Zod schemas and the generator emits the spec. The fitness test in `api/src/platform/__tests__/api-contract.fitness.test.ts` walks the live Express router stack and asserts that every registered route appears in the generated spec and every spec path has a corresponding route handler. Drift in either direction fails the build.

The surprising finding: Express `router.stack` exposes route layers with their methods and paths, but path parameters use `:id` syntax while OpenAPI uses `{id}`. The generator normalises this at spec emission time — a one-line transform that prevents a class of drift bugs.

### 3. Stripe-Style HMAC + Timestamp Anti-Replay

The signing scheme `HMAC-SHA256(secret, "t=<unix>.<rawBody>")` prevents two distinct attacks: (1) body tampering (HMAC binds the signature to the exact bytes), and (2) replay attacks (the timestamp is inside the signed payload, so an attacker cannot reuse a valid signature with a fresh timestamp). The 5-minute tolerance window (`toleranceSec = 300`) is surfaced as a parameter to `verifyWebhook()` rather than hardcoded, allowing security-conscious subscribers to tighten it.

The discovery: HMAC-based anti-replay only works if the verifier checks the timestamp is within tolerance *and* that the timestamp in the header matches the timestamp inside the signed string. If they differ, the signature is valid but the delivery is a replay with a forged timestamp. `HmacSigner.ts` concatenates `t=<unix>` as a prefix of the signed payload to prevent this.
