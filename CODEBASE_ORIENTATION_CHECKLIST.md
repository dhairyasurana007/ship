# Codebase Orientation Checklist — Ship

**Author:** Dhairya Surana  
**Date:** 2026-05-18  
**Repository:** [US-Department-of-the-Treasury/ship](https://github.com/US-Department-of-the-Treasury/ship)

---

## Phase 1: First Contact

### 1. Repository Overview

> Read every file in the docs/ folder. Summarize the key architectural decisions in your own words.

| Document | Decision |
|---|---|
| `docs/unified-document-model.md` | Everything is a document. Issues, wikis, projects, sprints, and persons all live in a single `documents` table with a `document_type` discriminator. Properties are stored as JSONB and are type-specific. |
| `docs/application-architecture.md` | Boring technology chosen deliberately: Express, React, PostgreSQL, Yjs. No GraphQL, no ORMs, no tRPC. Direct SQL via `pg`. |
| `docs/document-model-conventions.md` | All new documents default to `"Untitled"` (not "Untitled Issue"). 4-panel editor layout is universal. The `Editor` component is shared across all document types. |
| `docs/sprint-documentation-philosophy.md` | Sprint workflow requires weekly plans, retros, and standups as first-class document types. |

---

> Read the shared/ package. What types are defined? How are they used across the frontend and backend?

Defined in `shared/src/types/`:

| File | Key Exports |
|---|---|
| `document.ts` | `DocumentType`, `Document`, `IssueDocument`, `ProjectDocument`, `WeekDocument`, `PersonDocument`, `TypedDocument` (discriminated union), `IssueProperties`, `ProjectProperties`, `WeekProperties`, `ApprovalState`, `ApprovalTracking` |
| `api.ts` | `ApiResponse<T>` (generic wrapper for all API responses) |
| `user.ts` | `User`, `WorkspaceMembership` |
| `auth.ts` | Session and token types |
| `workspace.ts` | `Workspace` |

`shared/src/constants.ts` exports `SESSION_TIMEOUT_MS` (15 min), `ABSOLUTE_SESSION_TIMEOUT_MS` (12 hrs), issue states, priorities, and other shared enumerations.

`shared/` is built first (`pnpm build:shared`), producing `shared/dist/*.d.ts`. Both `api/` and `web/` import from it. This enforces compile-time type safety on both sides of the HTTP boundary — if an API response shape changes, the frontend gets a type error immediately.

---

> Create a diagram of how the web/, api/, and shared/ packages relate to each other.

```
┌───────────────────────────────────────────────────────┐
│                     pnpm workspace                     │
│                                                        │
│  ┌──────────┐     imports     ┌─────────────────────┐  │
│  │  shared/ │◄────────────── │       api/           │  │
│  │          │                │  Express + WebSocket  │  │
│  │ TS types │◄────────────── │  REST + Collab server │  │
│  │ constants│                └─────────────────────┘  │
│  └──────────┘                                          │
│       ▲                      ┌─────────────────────┐  │
│       └──────────────────────│       web/           │  │
│                   imports    │  React + Vite + Yjs  │  │
│                              │  TipTap editor SPA   │  │
│                              └─────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

- **`shared/`** — TypeScript types and constants. No runtime logic. Build output: `shared/dist/*.d.ts`.
- **`api/`** — Express HTTP + WebSocket server. Owns PostgreSQL. Build output: `api/dist/`. Deployed to Elastic Beanstalk.
- **`web/`** — React SPA. Talks to `api/` via REST and WebSocket. Build output: static bundle deployed to S3 + CloudFront.

---

### 2. Data Model

> Find the database schema (migrations or seed files). Map out the tables and their relationships.

Schema defined in [`api/src/db/schema.sql`](../../api/src/db/schema.sql). All changes to existing tables go in numbered migration files under `api/src/db/migrations/` (currently 37 migrations).

```
documents (central table)
├── id (UUID PK)
├── workspace_id (FK → workspaces)
├── document_type ENUM('wiki','issue','program','project','sprint','person',
│                      'weekly_plan','weekly_retro','standup','weekly_review')
├── title TEXT
├── content JSONB          — TipTap editor JSON
├── yjs_state BYTEA        — Binary Yjs CRDT state
├── properties JSONB       — Type-specific properties
├── parent_id (FK → documents, self-referential)
├── ticket_number INT      — Auto-sequenced per workspace (issues only)
├── visibility ENUM('workspace','private')
└── created_by (FK → users)

document_associations (junction table for cross-document relationships)
├── document_id (FK → documents)
├── related_id  (FK → documents)
└── relationship_type ENUM('parent','project','sprint','program')

document_history (audit trail)
├── document_id, field, old_value, new_value, changed_by

users
├── id, email, password_hash, name, is_super_admin
└── x509_subject_dn (PIV card authentication)

workspace_memberships
└── workspace_id, user_id, role ENUM('admin','member')

sessions
└── id TEXT, user_id, workspace_id, expires_at, last_activity

api_tokens
└── user_id, workspace_id, token_hash (SHA-256), expires_at, revoked_at

comments
└── document_id, comment_id (TipTap mark ID), parent_id, author_id, content, resolved_at

files
└── workspace_id, uploaded_by, filename, s3_key, cdn_url

sprint_iterations / issue_iterations
└── id, parent_id, status, what_attempted, blockers_encountered, author_id
```

---

> Understand the unified document model: how does one table serve docs, issues, projects, and sprints?

One `documents` table serves all content types via the `document_type` column. The `properties` JSONB column holds type-specific data:

| `document_type` | Key properties fields |
|---|---|
| `issue` | `state`, `priority`, `assignee_id`, `estimate`, `due_date` |
| `project` | `impact`, `confidence`, `ease` (ICE scores 1–5), `owner_id`, `plan_approval`, `retro_approval` |
| `program` | `color`, `emoji`, `owner_id` (RACI R), `accountable_id` (RACI A) |
| `sprint` / week | `sprint_number` (required), `owner_id` (required), `status`, `plan_approval`, `review_approval` |
| `person` | `email`, `role`, `capacity_hours`, `reports_to` |
| `wiki` | `maintainer_id` |
| `weekly_plan` | `person_id` (required), `week_number` (required), `submitted_at` |
| `weekly_retro` | `person_id` (required), `week_number` (required), `submitted_at` |

**Tradeoff:** A single table simplifies cross-type queries and keeps editor/permissions/history logic uniform. The cost is that JSONB properties have no referential integrity — the database cannot enforce that `assignee_id` is a valid user UUID.

---

> What is the document_type discriminator? How is it used in queries?

`document_type` is a PostgreSQL ENUM column on the `documents` table. Every query filters on it:

```sql
-- List all issues in a workspace
SELECT * FROM documents
WHERE workspace_id = $1 AND document_type = 'issue'
ORDER BY created_at DESC;
```

In TypeScript, `DocumentType` is a string union type in `shared/src/types/document.ts`. Each document type maps to a specific properties interface, enforced via discriminated union types. At runtime the `document_type` value narrows the TypeScript type so the correct `properties` fields are accessible without casting.

---

> How does the application handle document relationships (linking, parent-child, project membership)?

Legacy direct columns (`project_id`, `program_id`) were replaced by the `document_associations` junction table (migrations 020–021). `sprint_id` was dropped in migration 027.

Relationship types: `parent`, `project`, `sprint`, `program`.

The junction table:
- Prevents duplicates via UNIQUE constraint on `(document_id, related_id, relationship_type)`
- Prevents self-references via a CHECK constraint
- Batch-loaded per request in `api/src/utils/document-crud.ts` to avoid N+1 queries

---

### 3. Request Flow

> Pick one user action (e.g., creating an issue) and trace it from the React component through the API route to the database query and back.

**React component** (`web/src/components/IssuesList.tsx`)  
→ TanStack Query mutation  
→ `POST /api/issues` with JSON body

**Route handler** (`api/src/routes/issues.ts`):
1. Zod validates body against `createIssueSchema`
2. `INSERT INTO documents (workspace_id, document_type='issue', title, content, properties, ...) RETURNING *`
3. For each `belongs_to` entry: `INSERT INTO document_associations ...`
4. Returns `{ success: true, data: IssueDocument }`
5. Broadcasts real-time event to connected WebSocket clients in the workspace

---

> Identify the middleware chain: what runs before every API request?

Defined in `api/src/app.ts`, in order:

1. **Helmet** — sets security headers (CSP, HSTS, X-Frame-Options)
2. **CORS** — restricts to `CORS_ORIGIN` env var (default: `localhost:5173`)
3. **`express.json()`** — parses JSON body (10 MB limit for large docs)
4. **Cookie parser** — extracts session cookie
5. **Rate limiter** — 100 req/min general, 5 failed logins / 15 min
6. **`authMiddleware`** (`api/src/middleware/auth.ts`) — validates session OR Bearer API token; sets `req.userId`, `req.workspaceId`
7. **CSRF protection** — verifies `X-CSRF-Token` header (skipped for Bearer token auth)

---

> How does authentication work? What happens to an unauthenticated request?

Three authentication mechanisms, checked in order by `authMiddleware`:

- **Session-based (primary):** `POST /api/auth/login` → validates password → creates row in `sessions` table → sets HTTP-only `connect.sid` cookie. Timeout: 15 min inactivity, 12 hr absolute.
- **API tokens (secondary):** Bearer token in `Authorization` header. Stored as SHA-256 hash in `api_tokens` table. Skips CSRF check.
- **PIV / X.509 (government):** X.509 Subject DN extracted from client certificate → matched against `users.x509_subject_dn`. Handled in `api/src/routes/caia-auth.ts`.

**Unauthenticated requests:** `authMiddleware` returns `401 Unauthorized` immediately. No session is created.

---

## Phase 2: Deep Dive

### 4. Real-time Collaboration

> How does the WebSocket connection get established?

URL format: `ws://localhost:3000/collaboration/{docType}:{docId}`  
Handler: `api/src/collaboration/index.ts`

1. Client sends HTTP Upgrade request with session cookie
2. Server extracts session ID, queries `sessions` table, validates expiry and workspace membership
3. Server checks document visibility (user must be a workspace member)
4. WebSocket upgrade completes (101 Switching Protocols)
5. Connection stored in `conns` Map: `WebSocket → { docName, userId, workspaceId, awarenessClientId }`

---

> How does Yjs sync document state between users?

Documents are loaded into memory as `Y.Doc` objects:
1. Server queries `yjs_state` (binary) from `documents` table
2. If `yjs_state` exists: `Y.applyUpdate(doc, yjs_state)` to hydrate
3. If only `content` JSON exists: converts JSON → Yjs (legacy fallback for older docs)

**Message types on the WebSocket:**
- `messageSync (0)` — Yjs sync: client sends its missing updates, server responds with its missing updates. After the initial handshake, subsequent changes are broadcast as update messages to all connected clients.
- `messageAwareness (1)` — Cursor positions and user presence (`{added, updated, removed}` client arrays)

---

> What happens when two users edit the same document at the same time?

Yjs uses CRDTs (Conflict-free Replicated Data Types). Each character/block insertion gets a unique `(clientId, clock)` tuple. Total ordering is guaranteed across all clients without coordination — two users typing at the same position get a deterministic, content-preserving merge with no data loss and no server round-trip needed to resolve conflicts.

---

> How does the server persist Yjs state?

Writes are debounced 2 seconds after each change:

```
Y.encodeStateAsUpdate(doc)   → BYTEA  → documents.yjs_state
yjsToJson(fragment)          → JSONB  → documents.content
extractHypothesis(content)   → text   → documents.properties
```

Both representations stay in sync: `yjs_state` is required for WebSocket sync; `content` is used by REST API reads and search indexing.

**Offline tolerance:** The web editor uses `IndexeddbPersistence` to cache Yjs state locally in the browser. On reconnect, local changes merge with server state automatically via CRDT semantics.

---

### 5. TypeScript Patterns

> What TypeScript version is the project using?

TypeScript **5.7.2** (declared in the root `package.json`).

---

> What are the tsconfig.json settings? Is strict mode on?

| Setting | Value | Meaning |
|---|---|---|
| `strict` | `true` | All strict checks enabled (noImplicitAny, strictNullChecks, etc.) |
| `noUncheckedIndexedAccess` | `true` | Array/object access returns `T \| undefined`, forces bounds checking |
| `noImplicitReturns` | `true` | All code paths must explicitly return |
| `target` | `ES2022` | Modern JS output |
| `module` | `NodeNext` | ESM-native imports |
| `declaration` + `declarationMap` | `true` | Emits `.d.ts` + source maps for cross-package imports |

**Strict mode is ON.**

---

> How are types shared between frontend and backend (the shared/ package)?

`shared/` is built first (`pnpm build:shared`), producing `shared/dist/*.d.ts` and `shared/dist/*.js`. Both `api/` and `web/` list `shared` as a workspace dependency in their `package.json`. Imports like `import type { Document } from 'shared/src/types/document'` resolve to the built declaration files. This enforces compile-time type safety on both sides of the HTTP boundary without duplicating type definitions.

---

> Find examples of: generics, discriminated unions, utility types (Partial, Pick, Omit), and type guards in the codebase. Are there any patterns you do not recognize? Research them.

**Discriminated unions** (`shared/src/types/document.ts`):
```typescript
export type TypedDocument =
  | IssueDocument      // document_type: 'issue'
  | ProjectDocument    // document_type: 'project'
  | WikiDocument
  | ProgramDocument
  | WeekDocument
  | PersonDocument;
```
Narrowed using type guards throughout `web/src/` before accessing type-specific `properties`.

**Generics** (`shared/src/types/api.ts`):
```typescript
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}
// e.g. ApiResponse<IssueDocument[]>
```

**Conditional / utility types** (`shared/src/types/document.ts`):
```typescript
export type PropertiesFor<T extends DocumentType> =
  T extends 'issue'   ? IssueProperties :
  T extends 'project' ? ProjectProperties :
  DocumentProperties;
```

**Zod + type inference** (`api/src/routes/issues.ts`):
```typescript
const createIssueSchema = z.object({ ... });
type CreateIssueRequest = z.infer<typeof createIssueSchema>;
// Runtime validation + compile-time type in one declaration
```

**Type guards:**
```typescript
function isIssueDocument(doc: Document): doc is IssueDocument {
  return doc.document_type === 'issue';
}
```

**Express global augmentation** (new pattern for me — module augmentation):
```typescript
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      workspaceId?: string;
      isSuperAdmin?: boolean;
    }
  }
}
```
This extends an external library's interface without modifying its source, a TypeScript technique called *declaration merging*. Used to add auth properties to every Express `Request` object without casting.

---

### 6. Testing Infrastructure

> How are the Playwright tests structured? What fixtures are used?

**Runner:** Playwright  
**Config:** `playwright.config.ts`  
**Test files:** `e2e/*.spec.ts` (100+ suites, grouped by feature: auth, issues, projects, weeks, editor, etc.)  
**Fixtures:**
- `e2e/fixtures/isolated-env.ts` — provisions a per-worker PostgreSQL container, API server, and Vite preview server
- `e2e/fixtures/test-helpers.ts` — shared utilities: `triggerMentionPopup()`, `hoverWithRetry()`, `waitForTableData()` (all with retry logic for parallelism flakiness)
- `e2e/fixtures/dev-server.ts` — manages server lifecycle for workers
- `e2e/global-setup.ts` — builds the web app once before any worker starts

Each `*.spec.ts` imports an extended Playwright `test` object from fixtures that provides a pre-authenticated `page` and `apiContext` for the worker's isolated environment.

---

> How does the test database get set up and torn down?

Each Playwright worker gets its own isolated environment:

1. **PostgreSQL container** starts via `testcontainers`
2. `node dist/db/migrate.js` applies all migrations against the container
3. `pnpm db:seed` inserts test data (users, workspaces, documents)
4. Tests run against this isolated state — no shared data between workers
5. Container is torn down after the worker finishes

Port allocation: each worker gets a deterministic port range (`10000 + workerIndex * 100`) to prevent race conditions when multiple workers call `getPort()` simultaneously.

The web app is built **once** in `global-setup.ts`. All workers share the same static build but hit their own API + database.

---

> Run the full test suite. How long does it take? Do all tests pass?

**Never run `pnpm test:e2e` directly** — it causes output explosion that crashes Claude Code. Use the `/e2e-test-runner` skill, which runs the suite in the background and polls `test-results/summary.json`.

Worker count is calculated dynamically: `floor((freeMemGB - 2) / 0.5)` capped at CPU core count. On a typical dev machine (16 GB RAM, 8 cores) this gives ~4–6 workers. Suite runtime varies but is typically 5–15 minutes. Retries: 1 locally, 2 in CI.

---

### 7. Build and Deploy

> Read the Dockerfile. What does the build process produce?

The `Dockerfile` produces a minimal production container:

- Base image: `node:20-slim` from AWS ECR
- SSL verification disabled for npm (government VPN requirement — `npm config set strict-ssl false`)
- Only production dependencies installed (`--prod --frozen-lockfile --ignore-scripts`)
- Copies **pre-built** `shared/dist/` and `api/dist/` (source is not in the image)
- Exposes port 80, sets `NODE_ENV=production`
- **Startup command:** `node dist/db/migrate.js && node dist/index.js` — migrations run automatically on every deploy before the server accepts traffic

The build process (run outside Docker before `docker build`) is: `pnpm build:shared` → `pnpm build:api`.

---

> Read the docker-compose.yml. What services does it start?

`docker-compose.yml` starts a single service: **PostgreSQL 16**.

- Used as an alternative to native PostgreSQL for local development
- Volume `postgres_data` persists data across restarts
- Credentials: user `ship`, password `ship_dev_password`, database `ship`
- Health check: `pg_isready -U ship`

Most developers use native PostgreSQL instead. The API and web servers are **not** in docker-compose — they run directly via `pnpm dev`.

---

> Skim the Terraform configs. What cloud infrastructure does the app expect?

```
Route53 (DNS)
    ↓
CloudFront (SPA routing via CloudFront Function) + WAF
    ├→ S3 bucket                  — React static bundle
    └→ ALB (sticky sessions)      — Required for WebSocket connection affinity
           └→ Elastic Beanstalk (t3.small)    — Express API
                  └→ Aurora Serverless v2 (0.5 ACU, PostgreSQL 16)

SSM Parameter Store   — DATABASE_URL, SESSION_SECRET, CORS_ORIGIN, etc.
```

Modules in `terraform/modules/{aurora,elastic-beanstalk,cloudfront-s3,vpc,security-groups,ssm}/`. Environments in `terraform/environments/{dev,prod,shadow}/`.

Key details:
- **SPA routing:** A CloudFront Function (`cloudfront-functions/spa-routing.js`) rewrites all non-asset paths to `/index.html` for React Router
- **WebSocket:** ALB sticky sessions required so WebSocket connections always hit the same EB instance
- **Secrets:** All sensitive config loaded from SSM Parameter Store at runtime, not baked into the container

---

> How does the CI/CD pipeline work (if configured)?

No GitHub Actions workflow files are present in the repository. Deployments are manual:

```bash
./scripts/deploy.sh prod           # API → Elastic Beanstalk (~3–5 min)
./scripts/deploy-frontend.sh prod  # Web → S3 sync + CloudFront invalidation (~1 min)
```

Infrastructure changes require `terraform apply` separately. The deploy scripts handle building, zipping, and uploading to EB or syncing to S3.

---

## Phase 3: Synthesis

### 8. Architecture Assessment

> What are the 3 strongest architectural decisions in this codebase? Why?

**1. Unified document model**  
Storing all content types in one `documents` table with a `document_type` discriminator dramatically simplifies cross-cutting concerns: associations, search, permissions, history, and the editor all work identically regardless of type. Adding a new document type requires no new table — only a new `document_type` value and a JSONB properties shape. The uniformity keeps the codebase small despite covering many content types.

**2. Shared TypeScript types across the monorepo**  
The `shared/` package gives compile-time type safety on both sides of the HTTP boundary. If an API response shape changes, the frontend immediately gets a type error. This catches an entire class of integration bugs before they reach production without needing GraphQL or OpenAPI codegen.

**3. Per-worker test isolation with Testcontainers**  
Each Playwright worker runs against its own PostgreSQL container and API instance. This eliminates test pollution, makes tests fully reproducible, and enables safe parallelism. The one-time global build of the web app keeps the approach fast despite container startup overhead — the right call for a real-time collaborative app where shared state would cause constant flakiness.

---

> What are the 3 weakest points? Where would you focus improvement?

**1. No ORM — proliferated raw SQL**  
Direct `pg` queries are scattered across 15+ route files with no query builder or type-safe query layer. Missing indexes and N+1 queries are easy to introduce silently. As the schema grows, tracking all the places a table is queried becomes a maintenance burden.

**2. Single Elastic Beanstalk instance for WebSockets**  
The Terraform config uses sticky sessions to route WebSocket connections to a single EB instance. If the instance restarts (deploy or crash), all active connections drop. Because Yjs docs are cached in-memory (the `docs` Map in `collaboration/index.ts`), a restart could lose edits that haven't flushed within the 2-second debounce window. Horizontal scaling requires a shared pub/sub layer (e.g., Redis) that doesn't exist yet.

**3. JSONB properties with no database-level enforcement**  
`document.properties` is JSONB, so PostgreSQL has no knowledge of its structure. Invalid data (e.g., `{ "state": 999 }`) is silently accepted. Type safety exists only in TypeScript at compile time. Any raw SQL query, seed script, or migration that bypasses TypeScript can silently corrupt properties — there are no CHECK constraints or JSON Schema validation at the DB level.

---

> If you had to onboard a new engineer to this codebase, what would you tell them first?

The core mental model is: **everything is a document**. Before looking at any route or component, read `docs/unified-document-model.md`. Once you understand that issues, wikis, projects, and sprints are all rows in the same table with different `document_type` values and `properties` shapes, the rest of the codebase follows naturally.

Second: `shared/` builds first. If you see confusing type errors on a fresh clone, run `pnpm build:shared`.

Third: never run `pnpm test:e2e` directly. Use the `/e2e-test-runner` skill.

---

> What would break first if this app had 10x more users?

**The WebSocket collaboration server.** It runs as a single in-memory process. Yjs documents are cached in a `Map<string, Y.Doc>` on one Elastic Beanstalk instance. At 10x users, concurrent editing would overwhelm one instance, and horizontal scaling is currently impossible without a shared pub/sub layer. This is the most fragile part of the architecture under load.

A close second: **Aurora Serverless v2 at 0.5 ACU minimum.** Cold starts after idle periods add latency. At 10x load the ACU auto-scales, but the first burst after an idle period would be noticeably slow for all users.
