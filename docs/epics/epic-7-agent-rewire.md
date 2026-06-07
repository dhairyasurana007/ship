# Epic 7 — Agent-as-Citizen Rewire

## Before

FleetGraph agent called `DocumentService` directly with `pool.query()` — no auth, no audit trail, no rate limiting. The agent was a privileged insider.

## Fix

Migration `062_agent_oauth_app_seed.sql` seeds FleetGraph system user + OAuth app. Feature flag `AGENT_USE_PUBLIC_API=true` switches the agent to use `@ship-dhairya/sdk` with Client Credentials grant. Behind the flag: SDK calls → `/api/v1/*` → `bearerAuth → rateLimit → auditLog → DocumentService`. Flag off preserves Part 2 test compatibility.

## After

FleetGraph is a platform citizen. Every agent action appears in `public_api_audit` with `client_id = fleetgraph_app`. Same rate limits and scope checks as any external app.

## Proof

Both `AGENT_USE_PUBLIC_API=false` and `=true` test runs pass. `api/src/__tests__/agent-audit-proof.test.ts` asserts `COUNT(*) WHERE client_id = fleetgraph > 0` after an agent turn.

