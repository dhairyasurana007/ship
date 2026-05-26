# FleetGraph Pre-Search

> Goal: make informed decisions about the agent's responsibilities and architecture before writing code.

---

## Phase 1: Define Your Agent

### 1. Agent Responsibility Scoping

**What events in Ship should the agent monitor proactively?**

- An issue has `started_at` set and no subsequent `state` change for 3+ days while sprint `status='active'`, or for more than 50% of remaining sprint duration (stale issue)
- A new `document_association` with `relationship_type='sprint'` is created after the sprint's `start_date` (scope creep)
- An issue state is `blocked` or issue content/title indicates blocker semantics (for example "blocked by", "waiting on") and unresolved duration crosses threshold (unresolved blocker)
- An issue in active project/workspace context has no sprint association, no assignee, and `updated_at` is more than 7 days ago, excluding terminal states (orphaned issue)

**What constitutes a condition worth surfacing?**

A condition is worth surfacing if it meets all three tests:
1. It represents a divergence from the team's stated plan (sprint scope, assignee, expected state progression)
2. It will compound over time if not addressed, i.e., staying quiet makes it worse
3. The human is unlikely to notice it without actively opening the affected document

Noise filter: deduplicate for 48 hours by `(entity_id, set_of_conditions)`. Re-surface only if condition set changes or worsening thresholds are crossed.

**What is the agent allowed to do without human approval?**

- Post an in-app notification to an affected team member
- Add a read-only comment on an issue summarising the detected condition and suggested next action
- Generate sprint health summaries (proactive daily digest, no mutations)
- Log the detection event to `fleetgraph_runs` for audit and trace purposes

**What must always require confirmation?**

- Reassigning an issue to a different person
- Moving an issue from one sprint to another
- Changing issue `state` (e.g., closing, cancelling, re-opening)
- Any mutation to core planning fields (`assignee_id`, sprint associations, issue state, title/content/properties)

**How does the agent know who is on a project?**

Primary: query `document_associations` where `related_id = project_id` and `relationship_type = 'project'`; this yields person documents linked to the project. Each person document has `properties->>'user_id'` to resolve to a `users` row.

Fallback: derive from assignees on all issues associated with the project. If a person is assigned to an issue in a project, they are treated as on the project.

**How does the agent know who to notify?**

| Condition | Notify |
|---|---|
| Stale issue | Assignee of the issue |
| Scope creep | Project owner (creator of the project document) |
| Unresolved blocker | Assignee of the blocked issue; escalate to project document creator after 48h |
| Orphaned issue | Project owner; fallback to all workspace admins if owner is missing/inactive |

**How does the on-demand mode use context from the current view?**

The frontend passes the current page's document type and ID as part of the chat invocation payload. The agent uses this to seed its context-loading step:

| View | Context loaded |
|---|---|
| `/issues/:id` | Issue document + last 30 days of history + sprint it belongs to + assignee profile |
| `/sprints/:id` | Sprint document + last 30 days of history + all associated issues (with states) + team capacity |
| `/projects/:id` | Project document + last 30 days of history + active sprint + recent velocity + team members |
| `/weeks/:id` | Week document + last 30 days of history + all open issues for the team |

The chat prompt is pre-seeded with this context so the user does not need to repeat what they are looking at. The agent reasons from the specific entity, not from the whole workspace.

---

### 2. Use Case Discovery

| # | Role | Trigger | Agent Detects / Produces | Human Decides |
|---|---|---|---|---|
| 1 | PM | Issue has `started_at` set but no state change in 3+ days during a sprint with `status='active'` | List of stale issues with days-since-state-change and current assignee; draft reassignment suggestion | Whether to reassign, move to next sprint, or accept the delay |
| 2 | PM / Director | New `document_association` with `relationship_type='sprint'` created after sprint `start_date` | Scope growth percentage, list of post-start additions, estimated impact on projected completion date | Whether to remove issues from the sprint or formally accept scope change |
| 3 | Engineer (on-demand) / PM (proactive) | Issue content indicates semantic blocker language or state is `blocked`, and unresolved duration crosses threshold (24h+, timer reset on state change or any new comment) | Blocking dependency candidate with confidence score, owner of blocking issue (if resolvable), days blocked, draft escalation message | Whether to escalate to PM, reassign, or accept the block and adjust timeline |
| 4 | Director | Invoked from sprint view, or end-of-day proactive run during active sprint | Sprint health score: completion rate vs. plan, at-risk issues, over-capacity team members, velocity trend | Whether to intervene (reprioritise, adjust capacity) or proceed as-is |
| 5 | PM | Issues in active project/workspace context with no sprint, no assignee, and `updated_at` > 7 days ago (excluding terminal states) | Grouped list of orphaned issues with suggested dispositions (archive, add to backlog, close) | What to do with each orphan; agent does not mutate them without approval |

---

### 3. Trigger Model Decision

**Decision: Hybrid - PostgreSQL LISTEN/NOTIFY as primary, scheduled poll as fallback**

Ship has no outbound webhook system. All events stay inside the Node.js process (WebSocket + EventEmitter). This means a webhook-driven trigger would require instrumenting Ship's internals. Instead:

**Primary trigger - PostgreSQL LISTEN/NOTIFY**

The FleetGraph service opens a persistent `pg.Client` connection and issues:
```sql
LISTEN document_changes;
```

A PostgreSQL trigger on `documents` and `document_associations` fires `pg_notify('document_changes', payload)` on INSERT and UPDATE. The payload carries `document_id`, `document_type`, and `change_type`. The agent receives this within milliseconds of the write and initiates a graph run for every document change.

**Fallback trigger - 2-minute poll**

A cron job queries:
```sql
SELECT id, document_type, updated_at
FROM documents
WHERE updated_at > $last_checked_at
ORDER BY updated_at DESC
LIMIT 200;
```

This catches any changes that bypassed the PG trigger (bulk migrations, direct DB writes, edge cases).

**Tradeoffs**

| | Poll only | Webhook | PG LISTEN + poll fallback |
|---|---|---|---|
| Detection latency | Up to poll interval | Near real-time | <1s primary, <=2min fallback |
| Idle cost | Constant | Zero | Near-zero (idle LISTEN is cheap) |
| Reliability | High | Requires Ship changes | High (fallback covers gaps) |
| Complexity | Low | Medium (Ship instrumentation) | Medium (PG trigger setup) |

**How stale is too stale?**

For high-priority detections (scope creep, blockers), target surfacing within minutes. For stale/orphan checks, near-real-time is acceptable but not required per event. The hybrid model meets the <5 minute SLA for critical paths.

**Cost at scale**

With PG LISTEN, the agent only runs the graph when something actually changed. Estimate 20-50 meaningful runs per active project per day (real activity), not 720 (polling every 2 minutes blind).

- 100 projects x 35 runs/day = 3,500 runs/day
- 1,000 projects x 35 runs/day = 35,000 runs/day

Operational note: because every document change can trigger a run, use a bounded FIFO worker queue with explicit max concurrency to avoid run storms.

---

## Phase 2: Graph Architecture

### 4. Node Design

```
START
  +-- ingest_trigger          # classifies trigger: schedule | pg_event | user_request
        +-- [proactive path]
        ¦     +-- load_project_context
        ¦     +-- fetch_issues
        ¦     +-- fetch_sprint_state
        ¦     +-- fetch_team_state
        ¦           +-- classify_conditions
        ¦                 +-- assess_severity
        ¦                       +-- [no conditions] ? END (silent)
        ¦                       +-- [info only] ? emit_digest
        ¦                       +-- [warning/critical, no mutation] ? notify_in_app ? END
        ¦                       +-- [action required] ? human_gate ? [approved] ? execute_action ? END
        ¦                                                           +-- [dismissed/snoozed] ? record_snooze ? END
        ¦
        +-- [on-demand path]
              +-- load_view_context
                    +-- reason_on_context
                          +-- generate_response
                                +-- [read-only response] ? return to chat ? END
                                +-- [action proposed] ? human_gate ? [approved] ? execute_action ? END
```

**Parallel fetch nodes**: `fetch_issues`, `fetch_sprint_state`, and `fetch_team_state` all run in parallel after `load_project_context` resolves.

**Conditional edges**:
- After `classify_conditions`: route to END if nothing detected
- After `assess_severity`: branch on severity tier (info ? digest, warning/critical ? immediate notify, action-required ? gate)
- After `human_gate`: branch on human decision (approve ? execute, dismiss/snooze ? record and exit)

---

### 5. State Management

**State carried across a single graph session**

```typescript
interface FleetGraphState {
  trigger: { type: 'schedule' | 'pg_event' | 'user_request'; payload: unknown };
  viewContext: { documentType: string; documentId: string } | null;
  fetchedData: {
    issues: Issue[];
    sprint: Sprint | null;
    team: TeamMember[];
  };
  detectedConditions: Condition[];
  pendingAction: ProposedAction | null;
  humanDecision: 'approved' | 'dismissed' | 'snoozed' | null;
}
```

**State that persists between proactive runs** (stored in `fleetgraph_state` PostgreSQL table)

| Key | Value | Purpose |
|---|---|---|
| `last_checked_at` | timestamp per project | Poll fallback waterline |
| `last_alert_sent` | {condition_type, entity_id, condition_set} ? timestamp | Dedup and worsening checks |
| `snoozed_until` | {condition_type, entity_id} ? timestamp | Honour snooze decisions |
| `approval_requests` | proposal metadata + created_at | Enforce 24-hour approval TTL |

**Avoiding redundant API calls**

- Cache fetched data in-memory for the duration of a single run; nodes read from `state.fetchedData`
- Keep proactive processing bounded by queue concurrency limits
- Reuse loaded context within a single on-demand interaction path

---

### 6. Human-in-the-Loop Design

**Actions requiring confirmation**

- Reassigning an issue to a different person
- Moving an issue to a different sprint
- Changing issue state (closing, cancelling, re-opening)

**Confirmation experience in Ship**

Two surfaces:

1. **In-app notification banner**: shows proposed change with `Approve` / `Dismiss` controls.
2. **Chat response**: on-demand path returns a structured action card with explicit confirm/reject controls.

**If dismissed/rejected**: drop the proposal (no suppression record). Re-propose only when a new material state change occurs.

**If approval is idle >24h**: expire the request, notify requester of expiry, and require a fresh proposal.

---

### 7. Error and Failure Handling

**When Ship API is down**

- Wrap API calls with retry logic (3 attempts, exponential backoff)
- After repeated failures for a project, pause proactive processing for a short backoff window
- Log failures to `fleetgraph_runs` with machine-readable status

**Graceful degradation**

- If one fetch source fails, continue with partial context when safe and mark response as partial
- If LLM reasoning fails, fall back to rule-based detection paths where possible
- Keep FleetGraph asynchronous and non-blocking to Ship UI workflows

**What gets cached and for how long**

| Data | Cache TTL | Storage |
|---|---|---|
| Team membership (`/api/team`) | 1 hour | `fleetgraph_state` table |
| Sprint structure (dates/properties) | 30 minutes | `fleetgraph_state` table |
| Issue list | Per-run only | In-memory |

---

## Phase 3: Stack and Deployment

### 8. Deployment Model

**Where does the proactive agent run when no user is present?**

A separate Node.js service (`api/src/fleetgraph/`) deployed as an AWS Elastic Beanstalk Worker Environment. This runs independently of the web-serving EB environment, so long-running graph execution never blocks user HTTP requests.

The worker environment shares the same RDS PostgreSQL instance, which is how it maintains the PG LISTEN connection and reads/writes `fleetgraph_state`.

**How is it kept alive?**

- PM2 process manager inside the EB instance auto-restarts the service on crash
- EB health checks ping a `/health` endpoint on the FleetGraph service
- DB connection keepalive prevents idle disconnect drift

**How does it authenticate with Ship without a user session?**

Ship already has `/api/api-tokens` for CLI authentication. A dedicated `fleetgraph-service` API token is created once during setup and stored as an EB environment variable (`FLEETGRAPH_API_TOKEN`). Proactive agent API calls use `Authorization: Bearer <token>`.

---

### 9. Performance

**How does the trigger model achieve the <5 minute detection latency goal?**

- PG LISTEN/NOTIFY path: typically 10-20 seconds end-to-end
- Fallback poll path: worst case ~2.5 minutes including execution
- Both paths satisfy the <5 minute SLA

**Token budget per invocation**

| Node | Input tokens | Output tokens |
|---|---|---|
| Context loading (issues + sprint + team) | ~2,000 | — |
| `classify_conditions` (rule-based, no LLM) | — | — |
| `reason_on_context` (on-demand chat) | ~3,000 | ~600 |
| `generate_response` / `notify_in_app` | ~500 | ~300 |
| **Total per proactive run** | **~2,500** | **~300** |
| **Total per on-demand chat** | **~3,500** | **~700** |

At `gpt-4o-mini` pricing (input $0.15/M, output $0.60/M):
- Proactive run: ~$0.00056
- On-demand chat: ~$0.00095

**Where are the cost cliffs?**

1. **Large projects with many issues**: wide issue fetches increase context size and run cost.
2. **High-frequency on-demand chat**: repeated contextual reasoning in the same session compounds spend.
3. **Burst update periods**: many document writes can queue many runs; bounded concurrency protects stability but can increase queue wait under load.
