# EARLY_SUBMISSION_PLAN

## Mandatory Execution Policies

- Branch policy: all FleetGraph early-submission work must be committed and pushed to `early-submission` branch only.
- Bug-first policy: if any Ship bug or behavior issue is discovered, stop current task, fix the bug first, retest impacted areas, then resume.

## Baseline: PRD Early-Submission Readiness Mapping

| Requirement | Current State | Status | Notes |
|---|---|---|---|
| Proactive mode running end-to-end | Trigger runtime exists (`PG LISTEN` + poll fallback), condition classification exists | Partial | Outputs currently routed in memory but not yet fully persisted as user-facing FleetGraph artifacts |
| On-demand mode in embedded UI context | Document panel + global launcher call `/api/fleetgraph/chat` with context scope | Implemented | Needs stronger E2E evidence for scope fidelity |
| Human-in-the-loop gating | Approval request/approve/reject/execute/expire API exists | Partial | Needs end-to-end UI lifecycle validation evidence |
| Test cases documented in `FLEETGRAPH.md` | Test-case table exists | Partial | Trace links still `[TBD]` |
| Architecture decisions documented | Section exists in `FLEETGRAPH.md` | Partial | Needs final update to reflect implemented behavior exactly |
| Observability traces showing different paths | LangSmith client/instrumentation exists | Partial | Must capture and publish shared links from real runs |
| Running against real Ship data | APIs and DB integration present | Partial | Must prove via deterministic test workflows and trace-backed cases |
| Deployed/publicly accessible for grading checkpoint | Repo has deploy scripts | Partial | Must be re-verified as part of submission routine |
| Detection latency target (<5 min) defended and testable | Trigger model and estimates documented | Partial | Needs timed run evidence from real proactive path |

## Commit-by-Commit Delivery Plan

1. Commit 1: Baseline + gap audit snapshot (this file), then run `pnpm type-check`, `pnpm test`, and E2E smoke workflow.
2. Commit 2: Persist proactive outputs as user-facing artifacts with recipient routing and audit metadata.
3. Commit 3: Complete human-gate UX lifecycle validation (approve/reject/expire) with E2E coverage.
4. Commit 4: Harden on-demand context fidelity and embedded UX behavior with tests.
5. Commit 5: Capture real observability evidence; replace trace placeholders in `FLEETGRAPH.md`.
6. Commit 6: Finalize early-submission documentation pass and full FleetGraph validation sweep.

## Thursday Early-Submission Acceptance Checklist

- `FLEETGRAPH.md` includes:
  - Complete `Test Cases` section with real shared trace links (no placeholders).
  - Updated `Architecture Decisions` matching actual implementation.
- FleetGraph proactive flow produces persisted, user-visible outputs with routing aligned to responsibility rules.
- Human gate prevents mutation without explicit approval and supports reject/expire behavior.
- On-demand chat proves context-aware behavior from embedded UI surfaces.
- Validation logs captured for:
  - `pnpm type-check`
  - `pnpm test`
  - FleetGraph-targeted Playwright flows through the repository E2E runner workflow.
- All commits and pushes for this scope are on `early-submission` only.

## Implementation Status (Current)

- Completed:
  - FleetGraph proactive outputs persistence model and API retrieval route.
  - FleetGraph launcher UI now surfaces recent alerts and pending approvals.
  - Human-gate API list endpoint for pending approvals.
  - On-demand response now returns degraded-context flags.
  - New FleetGraph E2E specs added:
    - `e2e/fleetgraph-proactive-notifications.spec.ts`
    - `e2e/fleetgraph-human-gate.spec.ts`
    - `e2e/fleetgraph-ondemand-context.spec.ts`
  - Cross-platform Ship build bug fixed in `@ship/api` build script (Windows `cp` failure).
- Blocked in this local host:
  - Full API unit test suite (`pnpm test`) requires local PostgreSQL on `:5432`.
  - FleetGraph Playwright execution requires container runtime for `testcontainers`.
