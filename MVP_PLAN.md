# MVP_PLAN.md

## Scope
This plan implements the FleetGraph MVP described in `FLEETGRAPH.md` and aligned with the Week 5 PRD requirements:
- Both modes: proactive + on-demand
- Shared graph architecture
- At least one proactive detection wired end-to-end
- Human-in-the-loop gate
- UI-visible chat + notification outputs
- Trigger model implemented and defended
- Test cases mapped to LangSmith traces

## Branch and commit strategy
- Use one commit per step below.
- Keep each commit vertically sliceable (code + tests + docs updates).
- After each commit, run listed checks before pushing.

---

## Commit 1: Scaffold FleetGraph service and config
### Implement
- Add `api/src/fleetgraph/` module skeleton:
  - `index.ts` (service bootstrap)
  - `types.ts` (graph state and condition types)
  - `config.ts` (env parsing: model, API key, feature flags)
  - `logger.ts` (structured logs with run id)
- Add DB migration(s) for MVP persistence:
  - `fleetgraph_runs` (audit/observability)
  - `fleetgraph_state` (dedup, approvals, queue metadata)
- Wire bootstrap from API/server startup behind env flag (`FLEETGRAPH_ENABLED=true`).

### Tests/workflows to add
- Unit test: config validation (missing/invalid env behavior).
- Unit test: migration smoke check (tables can be created and read).
- Workflow file to add:
  - `.github/workflows/fleetgraph-scaffold.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Start app with FleetGraph enabled.
- Confirm API boots cleanly.
- Confirm tables exist in local DB.
- Confirm health/log output shows FleetGraph service initialized.

---

## Commit 2: Implement trigger layer (PG LISTEN + poll fallback)
### Implement
- Add trigger runtime:
  - PG LISTEN on `document_changes`
  - 2-minute poll fallback over `documents.updated_at`
- Add bounded FIFO queue with max concurrency config.
- Emit run envelopes (`run_id`, trigger type, entity metadata).
- Record trigger events to `fleetgraph_runs` with status transitions.

### Tests/workflows to add
- Unit/integration tests:
  - LISTEN event enqueues run.
  - Poll fallback enqueues runs when watermark advances.
  - Queue honors FIFO and max concurrency.
- Workflow file to add:
  - `.github/workflows/fleetgraph-trigger-layer.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Perform a document update in UI and verify a proactive run is logged.
- Temporarily disable LISTEN connection and verify poll fallback still triggers runs.
- Confirm queue behavior under burst edits (no crash, backlog drains).

---

## Commit 3: Build proactive context + rule classification nodes
### Implement
- Implement proactive nodes:
  - `load_project_context`
  - `fetch_issues`
  - `fetch_sprint_state`
  - `fetch_team_state` (team context only; standup detection out of scope)
  - `classify_conditions`
- Implement conditions from `FLEETGRAPH.md`:
  - stale issue
  - sprint scope creep
  - unresolved blocker (semantic + state)
  - orphaned issue
- Implement condition severity + payload normalization.

### Tests/workflows to add
- Add rule tests for each condition with edge cases:
  - stale threshold math
  - blocker timer reset on comment/state change
  - orphan terminal-state exclusion
  - scope creep post-start association detection
- Workflow file to add:
  - `.github/workflows/fleetgraph-proactive-classification.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Seed known scenarios and trigger proactive run.
- Verify each expected condition appears in run output.
- Verify no false positives on terminal-state orphan cases.

---

## Commit 4: Add dedup/worsening logic and run persistence
### Implement
- Implement dedup key: `(entity_id, set_of_conditions)`.
- Implement 48-hour suppression window.
- Implement worsening bypass rules:
  - stale 24h bucket
  - scope creep count increase
  - blocker 48h/72h
  - orphan 7-day bucket
- Persist dedup and run reasoning metadata in `fleetgraph_state`/`fleetgraph_runs`.

### Tests/workflows to add
- Unit tests:
  - repeat alert suppressed within 48h
  - condition-set change bypasses suppression
  - worsening threshold causes re-alert
- Workflow file to add:
  - `.github/workflows/fleetgraph-dedup-worsening.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Re-run same trigger twice inside 48h and confirm no duplicate notification.
- Modify condition set (`{stale}` -> `{stale, blocker}`) and confirm new notification fires.

---

## Commit 5: Human-in-the-loop gate + approval lifecycle
### Implement
- Implement `human_gate` for all mutations:
  - reassign issue
  - move issue sprint
  - change issue state
- Implement approval request persistence and TTL (24h).
- Implement rejection behavior: forget on reject (no suppression record).
- Implement expiry notification when request exceeds TTL.

### Tests/workflows to add
- API tests:
  - mutation blocked without approval
  - approved mutation executes
  - rejection does not execute
  - expiry path emits expiry notification
- Workflow file to add:
  - `.github/workflows/fleetgraph-human-gate.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Ask for action in chat, verify approval UI appears.
- Reject request and verify mutation does not happen.
- Create aged approval record and verify expiry behavior.

---

## Commit 6: Notification + digest output surfaces
### Implement
- Implement `notify_in_app` output path.
- Implement daily digest output path for info-level findings.
- Implement merged notification behavior for notification-only multi-condition cases.
- Keep action-required proposals separate from notification-only outputs.

### Tests/workflows to add
- Unit/integration tests:
  - merged notification for multiple notification-only conditions
  - split behavior when action-required condition exists
- Workflow file to add:
  - `.github/workflows/fleetgraph-notifications-digest.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Trigger a notification-only condition and confirm in-app notification appears.
- Trigger mixed notification + action-required case and verify separate outputs.

---

## Commit 7: On-demand mode with view-context loading
### Implement
- Add chat entrypoint integration that accepts `{ documentType, documentId }`.
- Implement `load_view_context` with strict 30-day history cap.
- Implement `reason_on_context` + `generate_response` with `gpt-4o-mini`.
- Enforce explicit confirm before any proposed mutation.

### Tests/workflows to add
- Integration tests:
  - context loaded from current view without restating context
  - 30-day history cap honored
  - action proposal requires explicit confirm
- Workflow file to add:
  - `.github/workflows/fleetgraph-on-demand-context.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`
  - `corepack pnpm test:e2e -- --grep "fleetgraph|chat|weeks|issues"` (use your `/e2e-test-runner` flow)

### Post-push physical verification
- Open issue/sprint/project/week views and invoke chat.
- Verify responses reflect current view context.
- Verify old (45+ day) event is excluded from reasoning.

---

## Commit 8: UI integration for agent chat + confirmation cards
### Implement
- Add/extend UI components for:
  - FleetGraph chat panel integration in-context
  - actionable confirmation cards
  - approval/reject controls and status updates
- Ensure updates are accessible and visible in normal workflow pages.

### Tests/workflows to add
- Web unit tests for UI state transitions.
- E2E test covering full user flow:
  - trigger condition -> notification appears -> open card -> approve/reject -> observe result.
- Workflow file to add:
  - `.github/workflows/fleetgraph-ui-integration.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C web test`
  - `corepack pnpm test:e2e -- --grep "fleetgraph|notification|approval"` (use `/e2e-test-runner`)

### Post-push physical verification
- Use app manually to validate:
  - notification rendering
  - chat response rendering
  - approval card interactions
  - post-action state changes in issue/sprint UI

---

## Commit 9: Observability and traceability (LangSmith + run IDs)
### Implement
- Add LangGraph/LangSmith instrumentation to all graph paths.
- Ensure each run links internal `run_id` with trace metadata.
- Add structured logs and minimal dashboard query doc for run triage.

### Tests/workflows to add
- Smoke test asserting tracing env config is honored.
- Add doc checklist for collecting required trace links per MVP test cases.
- Workflow file to add:
  - `.github/workflows/fleetgraph-observability.yml`
- Workflow command(s) in that workflow:
  - `corepack pnpm -C api test`

### Post-push physical verification
- Trigger one proactive and one on-demand run.
- Confirm both appear in LangSmith with distinct execution paths.
- Confirm internal `fleetgraph_runs` rows correlate with trace IDs.

---

## Commit 10: PRD acceptance hardening + docs finalization
### Implement
- Fill trace links in `FLEETGRAPH.md` test table for executed cases.
- Update `FLEETGRAPH.md`/`PRESEARCH.md` if implementation details changed.
- Add MVP runbook in docs:
  - env setup
  - seed prerequisites
  - trigger simulation commands
  - verification checklist

### Tests/workflows to add
- Full validation workflow:
  - `corepack pnpm -C api test`
  - `corepack pnpm -C web test`
  - targeted e2e suite via `/e2e-test-runner`
- Workflow file to add:
  - `.github/workflows/fleetgraph-mvp-acceptance.yml`
- Optional pre-push script/CI job that runs API+web tests.

### Post-push physical verification
- Perform end-to-end grader-style walkthrough:
  - proactive detection in running app
  - on-demand contextual answer
  - one human-gated mutation
  - observable traces and run logs
- Confirm all PRD MVP checklist items are demonstrably satisfied.

---

## Suggested commit messages
1. `feat(fleetgraph): scaffold service, config, and persistence tables`
2. `feat(fleetgraph): add pg listen trigger, poll fallback, and bounded queue`
3. `feat(fleetgraph): implement proactive context fetch and condition classifiers`
4. `feat(fleetgraph): add dedup and worsening thresholds`
5. `feat(fleetgraph): implement human gate approval lifecycle`
6. `feat(fleetgraph): add notifications and digest output routing`
7. `feat(fleetgraph): implement on-demand context mode with 30-day cap`
8. `feat(web): integrate fleetgraph chat and approval card ui`
9. `feat(obs): add langsmith tracing and run-id correlation`
10. `docs(fleetgraph): finalize mvp evidence, traces, and runbook`

## Definition of done for MVP
- At least one proactive condition is live end-to-end in deployed app.
- At least one on-demand flow is live end-to-end in deployed app.
- Human approval gate blocks all mutations until explicit approval.
- Test cases are implemented and trace links are populated.
- Cost and trigger model documentation reflects actual behavior.
