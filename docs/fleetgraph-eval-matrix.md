# FleetGraph Eval Matrix

This matrix defines automated eval coverage for FleetGraph behavior in [`FLEETGRAPH.md`](/C:/Users/dhair/ship/FLEETGRAPH.md) and current agent implementation.

## FLEETGRAPH Test Cases (1-14)

1. Stale issue detection: `api/src/__tests__/fleetgraph-proactive-classification.test.ts`
2. Sprint scope creep detection: `api/src/__tests__/fleetgraph-proactive-classification.test.ts`
3. Blocker uncertainty + gate: `api/src/__tests__/fleetgraph-proactive-classification.test.ts`, `api/src/__tests__/fleetgraph-human-gate.test.ts`
4. Blocker timer reset behavior: `api/src/__tests__/fleetgraph-proactive-classification.test.ts`
5. On-demand sprint context chat: `api/src/__tests__/fleetgraph-on-demand-context.test.ts`, `e2e/fleetgraph-ondemand-context.spec.ts`
6. Orphaned issue detection and gating: `api/src/__tests__/fleetgraph-proactive-classification.test.ts`, `api/src/__tests__/fleetgraph-human-gate.test.ts`
7. 48h dedup suppression: `api/src/__tests__/fleetgraph-dedup-worsening.test.ts`
8. Condition-set change bypasses dedup: `api/src/__tests__/fleetgraph-dedup-worsening.test.ts`
9. Notification + action-required split routing: `api/src/__tests__/fleetgraph-notifications.test.ts`, `e2e/fleetgraph-proactive-notifications.spec.ts`
10. Multi-action request requires confirmation: `api/src/__tests__/fleetgraph-on-demand-context.test.ts`, `web/src/components/fleetgraph/FleetGraphAssistantPanel.test.tsx`
11. Approval expiry after TTL: `api/src/__tests__/fleetgraph-human-gate.test.ts`
12. Rejection behavior: `api/src/__tests__/fleetgraph-human-gate.test.ts`
13. 30-day history cap: `api/src/__tests__/fleetgraph-on-demand-context.test.ts`
14. Burst queue behavior: `api/src/__tests__/fleetgraph-trigger-queue.test.ts`, `api/src/__tests__/fleetgraph-trigger-runtime.test.ts`

## Current Agent Behavior (Codebase-specific)

1. Ask Permission vs Full Access payload behavior:
   - `web/src/components/fleetgraph/FleetGraphAssistantPanel.test.tsx`
2. Approval button rendering rules (reject/execute only when recommended):
   - `web/src/components/fleetgraph/FleetGraphGlobalLauncher.test.tsx`
3. Degraded context notice rendering:
   - `web/src/components/fleetgraph/FleetGraphGlobalLauncher.test.tsx`
4. Tool intent inference (create/update/delete, including "delete this" in document scope):
   - `api/src/__tests__/fleetgraph-tools-intent.test.ts`
5. LangSmith tracing client behavior:
   - `api/src/__tests__/fleetgraph-langsmith.test.ts`
6. Observability trace context configuration:
   - `api/src/__tests__/fleetgraph-observability.test.ts`
