# PlugForge Presearch Conversation

**Interviewer:** What are the hard constraints we need to design around?

**Assistant:** Demo load is modest: roughly 20-50 req/min in a grader session, so the public API can use in-memory rate limiting and webhook delivery without Redis. Webhook fanout is small, delivery logs stay tiny at demo volume, and CLI device-flow concurrency is only 1-3 sessions. The sprint is also budgeted tightly: CI has to stay under about 3 minutes per PR, and the SDK must stay under the PRD size cap.

**Interviewer:** What does that mean for infrastructure choices?

**Assistant:** Keep it boring. In-memory limiter and in-memory webhook deliverer are fine for the sprint, with explicit ceilings documented. The platform layer is designed so a future BullMQ/Redis deliverer can replace the in-memory one without changing callers, but we do not pay that complexity cost now.

**Interviewer:** What OAuth flows did we choose, and why?

**Assistant:** Web apps use Authorization Code + PKCE. That is the correct browser-based flow and it fits Ship's session-auth consent screen. The CLI uses Device Authorization Grant because it is non-interactive and works cleanly for `ship login`. For the agent, we use Client Credentials because it is a first-party server process with no user in the loop and no browser step.

**Interviewer:** Why keep refresh tokens from day one?

**Assistant:** Because adding them later would force a token-table migration anyway. The schema needs `family_id` up front so refresh-token rotation and stolen-token invalidation work cleanly from the start.

**Interviewer:** How did we handle scope and consent complexity?

**Assistant:** No incremental consent. New scopes require re-consent. That keeps the model simple for the sprint and avoids extra state in the authorization flow. Also, `/api/v1/me` only accepts user-context tokens; Client Credentials tokens get `403` because machine tokens do not represent a user.

**Interviewer:** What is the public API boundary?

**Assistant:** Everything public lives under `/api/v1/` with bearer auth, scope checks, rate limiting, and audit logging. Internal `/api/` routes can still call domain services directly. The key tradeoff is intentional duplication at the boundary: the public layer attaches contract concerns, while the internal layer stays free of bearer/auth overhead.

**Interviewer:** Why not expose internal routes or bypass the API for the developer portal?

**Assistant:** Because the portal should dogfood the real public surface. It uses only `/api/v1/`, which proves the API is complete and avoids an internal escape hatch that would hide contract gaps.

**Interviewer:** How is OpenAPI handled?

**Assistant:** OpenAPI is generated from route metadata and Zod schemas, not hand-written as the source of truth. That avoids drift between route code and spec. The fitness test walks the live Express router and the generated spec in both directions; if a route exists without spec coverage, or a spec path has no handler, the build fails.

**Interviewer:** Why not generate the SDK from OpenAPI?

**Assistant:** We want TypeScript ergonomics that generated clients usually do not give us: async iterators, strong discriminated unions, and a clean resource-based API. So the SDK is hand-written, but parity-tested against the spec to catch drift. That gives us better DX without losing contract discipline.

**Interviewer:** What shape does the SDK take?

**Assistant:** A `ShipClient` entry point with resource clients like `DocumentsClient`, `IssuesClient`, `SprintsClient`, and `WebhooksClient`. Pagination is async-iterator-first, and errors use a typed `ShipError` union. The token store handles both access and refresh tokens, with a mutex around refresh to avoid thundering-herd behavior.

**Interviewer:** What did we decide for webhooks?

**Assistant:** Webhooks are HMAC-signed with a Stripe-style `t=<unix>.<rawBody>` payload. Delivery is at-least-once, with retry scheduling, dead-lettering after repeated failures, and a replay endpoint that preserves the original idempotency key. The delivery log is part of the public developer story, and the portal shows only ID and event type, not payload bodies, to reduce leakage.

**Interviewer:** Why that model instead of exactly-once?

**Assistant:** Exactly-once is too expensive and unnecessary for this sprint. At-least-once plus idempotency keys gives subscribers a workable dedupe contract, and it keeps the implementation understandable. 4xx errors are treated as permanent except `429`, which is transient because the subscriber is busy, not dead.

**Interviewer:** How do we test webhook behavior without slow sleeps?

**Assistant:** The deliverer depends on an injected clock. Tests use a fake clock to advance retry time deterministically, so retry scheduling is testable without `setTimeout` noise.

**Interviewer:** What are the real sprint cost drivers?

**Assistant:** CI minutes are the only meaningful direct sprint cost. The platform itself does not add LLM spend; the agent rewire keeps the same call shape as Part 2, so the expected AI cost stays flat. On the platform side, the main production cost drivers are public API traffic, webhook deliveries, and retained audit/delivery log rows.

**Interviewer:** How did you think about production scaling costs?

**Assistant:** Costs scale with traffic and fanout, not with the SDK or public API surface area. The assumptions are a small number of subscriptions per event type, a bounded delivery retry policy, and a finite log retention window. That keeps the cost model predictable and easy to explain in the final submission.

**Interviewer:** What about failure modes?

**Assistant:** If the OpenAPI generator fails at boot, the server still starts but `/api/v1/openapi.json` returns `503`, and CI should catch it before deploy. If a webhook deliverer crashes mid-batch, in-memory in-flight deliveries are lost, which is acceptable for the sprint; the long-term upgrade path is a durable queue. If a `client_secret` leaks, rotation immediately invalidates the old secret.

**Interviewer:** What does the deployment story look like?

**Assistant:** One deployed Ship instance serves the public API, the developer portal, and the published OpenAPI spec. The grader gets a pre-registered read-only OAuth app in the README so they can run the device flow or browser flow immediately. The only public contract they need is `/api/v1/` plus the SDK entry points.

**Interviewer:** How do we keep the developer experience tight for graders?

**Assistant:** The README should let a grader go from `pnpm install @ship-dhairya/sdk` to `ship login` without hunting for hidden setup steps. The one-command story matters because it proves the platform is actually consumable, not just technically correct.

**Interviewer:** What is the main testing philosophy?

**Assistant:** Contract tests first, then flows. The fitness tests prove the route/spec/error contract, the OAuth tests prove the auth flows, the webhook tests prove signature and retry behavior, and the TTFE drill proves the whole developer story still works end-to-end. If a test only checks implementation details, it is secondary to the contract checks.

**Interviewer:** How is the agent being rewired?

**Assistant:** Behind a feature flag: `AGENT_USE_PUBLIC_API=true`. With the flag off, existing tests keep the old path. With it on, the agent uses `@ship-dhairya/sdk` and the public `/api/v1/` boundary like any external developer. The proof is in `public_api_audit`: the agent should produce rows with its `client_id`, not bypass the API.

**Interviewer:** What’s the actual tradeoff in that rewire?

**Assistant:** We accept a little more indirection in exchange for one unified security and audit model. The agent becomes a platform citizen: same scopes, same rate limits, same audit trail. That is the point of the rewire.

**Interviewer:** How does the proactive agent run?

**Assistant:** The PRD frames it as proactive on its own schedule or in response to Ship events, so the practical choice is hybrid: event-driven freshness from Ship events, plus scheduled runs where needed. The important constraint is detection latency under five minutes, while keeping cost and staleness bounded.

**Interviewer:** Any final architectural rule we should remember?

**Assistant:** Public contract at `/api/v1/`, internal services remain internal, OpenAPI is generated and fitness-tested, the SDK is hand-written but spec-checked, webhooks are signed and replayable, and the agent must go through the same public boundary as everyone else.

