# PlugForge AI Cost Analysis

This document captures the cost model for the PlugForge sprint. The platform itself does not add LLM usage; only the agent rewire uses model calls, and the rewire is intended to preserve the same call volume as the Part 2 path.

## Dev Spend

| Cost bucket | Assumption | Estimated cost |
|---|---|---:|
| CI per PR | TTFE drill, OAuth Playwright flow, unit tests, OpenAPI validation | ~$0.005 per PR |
| TTFE drill | ~15-30s runtime in CI | Included above |
| OAuth Playwright flow | Two browser flows, ~20s total | Included above |
| Full Vitest regression | ~30s total | Included above |
| OpenAPI generation/validation | In-process, low single-digit seconds | Included above |
| Agent rewire LLM spend | No net increase vs. existing Part 2 logic | $0 incremental |

Estimated weekly dev spend is dominated by CI minutes, not platform runtime.

## Production Projections

The platform-layer costs below scale with API traffic and webhook delivery volume. LLM cost is separated because it belongs to the agent's user-driven sessions, not to the public API itself.

| Tier | API calls/day | Webhook deliveries/day | Agent LLM calls/day | Est. cost/month |
|---|---:|---:|---:|---:|
| 100 users | ~20,000 | ~5,000 | ~50 | $2-$8 |
| 1,000 users | ~200,000 | ~50,000 | ~500 | $15-$50 |
| 10,000 users | ~2,000,000 | ~500,000 | ~5,000 | $80-$250 |
| 100,000 users | ~20,000,000 | ~5,000,000 | ~50,000 | $500-$1,500 |

## Assumptions

| Assumption | Value |
|---|---|
| Webhook fanout ratio | 2-3 subscriptions per event type at demo scale; assume 3 deliveries per write for planning |
| Agent active rate | 5% of users active on a given day, averaging 10 turns per active user |
| Delivery log retention | 30 days for webhook delivery rows |
| Audit log retention | 90 days for public API audit rows |
| Storage growth | Delivery log rows scale with fanout and retries; audit rows scale with public API calls |

## Notes

- The delivery log retention number matches the pre-search assumptions in [docs/presearch.md](./presearch.md).
- If the production deployment changes queueing or webhook fanout behavior, recalculate the table rather than reusing these numbers blindly.
