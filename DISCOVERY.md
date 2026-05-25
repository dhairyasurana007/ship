# Discovery Write-up

## Things I Learned

1. The unified document model is the core architectural bet in Ship.  
Issues, projects, programs, weeks, and people all live in the same `documents` table, and behavior is driven by `document_type` plus JSONB properties instead of separate content tables.

2. Request-level behavior can dominate benchmark outcomes as much as SQL plan quality.  
In production benchmarking, auth/session checks and middleware-path queries were a measurable part of Category 3 and Category 4 latency profiles, not just the main endpoint query.

3. Production measurements are materially different from local baselines.  
Running the same methodology against production infrastructure introduced higher latency and higher variance (including spikes), which changed conclusions versus local-only runs.

## Code Refs

- Unified model and conventions:
  - `docs/unified-document-model.md`
  - `docs/document-model-conventions.md`
  - `api/src/db/schema.sql`

- Cross-package typing and contracts:
  - `shared/src/types/document.ts`
  - `shared/src/types/api.ts`
  - `api/src/routes/documents.ts`
  - `web/src/lib/api.ts`

- Runtime request pipeline and auth/session behavior:
  - `api/src/app.ts`
  - `api/src/middleware/auth.ts`
  - `api/src/routes/dashboard.ts`
  - `api/src/routes/issues.ts`

- Query-audit instrumentation added for production auditability:
  - `api/src/observability/query-audit.ts`
  - `api/src/routes/query-audit.ts`
  - `api/src/openapi/schemas/query-audit.ts`

- Audit artifacts and measurements:
  - `AUDIT.md`
  - `IMPROVED_AUDIT.md`
  - `post-audit-evidence/category3-manual-latest.json`
  - `post-audit-evidence/category4-5runs-latest.json`

## Reflection

The biggest shift was moving from “code looks fine” to “prove it with repeatable evidence.” I also learned that AI is useful for exploration and synthesis, but not ideal for primary measurement execution. For measurements, the goal is deterministic runs, so I moved toward a command-driven workflow and created a `.cmd` audit tool to standardize methodology and outputs.

If I were to do this again, I would deploy the Ship app before the MVP phase and take baseline measurements there first. Instead, I initially used a local Docker Desktop path. After Docker issues and eventual uninstall, I reran measurements against the live deployed app. That change in environment is a key reason some later measurements were significantly higher than expected compared to earlier local baselines.

I also experimented with a new development workflow by using CE skills, which helped structure analysis and execution across multiple audit categories.
