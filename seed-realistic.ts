import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require(path.join(process.cwd(), 'api', 'node_modules', 'pg')) as {
  Pool: new (config: { connectionString: string }) => {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
    end: () => Promise<void>;
  };
};
const bcrypt = require(path.join(process.cwd(), 'api', 'node_modules', 'bcryptjs')) as {
  hash: (input: string, rounds: number) => Promise<string>;
};

type Counts = {
  users: number;
  documents: number;
  issues: number;
  sprints: number;
};

const TARGETS: Counts = {
  users: 30,
  documents: 750,
  issues: 180,
  sprints: 16,
};

const ISSUE_STATES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const WIKI_TOPICS = [
  'Architecture Notes',
  'Team Process',
  'Incident Follow-up',
  'Release Checklist',
  'API Design',
  'Quality Metrics',
  'Security Controls',
  'Sprint Planning',
  'Retrospective Notes',
  'Customer Feedback',
];

function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const root = process.cwd();
  const candidates = [
    path.join(root, 'api', '.env.local'),
    path.join(root, 'api', '.env'),
    path.join(root, '.env.local'),
    path.join(root, '.env'),
  ];

  for (const candidate of candidates) {
    const env = loadEnvFile(candidate);
    if (env.DATABASE_URL) return env.DATABASE_URL;
  }

  throw new Error(
    'DATABASE_URL not found. Set DATABASE_URL or create api/.env.local with DATABASE_URL.',
  );
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeDocContent(summary: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: summary }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Generated seed content for realistic workload simulation.`,
          },
        ],
      },
    ],
  };
}

async function getCounts(
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  workspaceId: string,
): Promise<Counts> {
  const [usersRes, docsRes, issuesRes, sprintsRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1',
      [workspaceId],
    ),
    pool.query(
      "SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1 AND document_type = 'issue'",
      [workspaceId],
    ),
    pool.query(
      "SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1 AND document_type = 'sprint'",
      [workspaceId],
    ),
  ]);

  return {
    users: usersRes.rows[0].count,
    documents: docsRes.rows[0].count,
    issues: issuesRes.rows[0].count,
    sprints: sprintsRes.rows[0].count,
  };
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const workspaceRes = await pool.query(
      'SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1',
    );
    if (workspaceRes.rowCount === 0) {
      throw new Error(
        'No workspace found. Run base setup first (for example: pnpm db:seed).',
      );
    }

    const workspaceId = workspaceRes.rows[0].id as string;
    const workspaceName = workspaceRes.rows[0].name as string;

    const initialCounts = await getCounts(pool, workspaceId);
    console.log(`Using workspace: ${workspaceName} (${workspaceId})`);
    console.log('Current counts:', initialCounts);

    const userIdsRes = await pool.query('SELECT id FROM users ORDER BY created_at ASC');
    const existingUserIds = userIdsRes.rows.map((r) => r.id as string);
    if (existingUserIds.length === 0) {
      throw new Error('No users found. Run base seed first to initialize the system.');
    }

    // Ensure required dev login credentials always work.
    const devHash = await bcrypt.hash('admin123', 10);
    const devUserRes = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      ['dev@ship.local'],
    );
    let devUserId: string;
    if (devUserRes.rowCount === 0) {
      devUserId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, is_super_admin)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [devUserId, 'dev@ship.local', devHash, 'Dev Admin'],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspaceId, devUserId],
      );
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
         VALUES ($1, 'person', $2, $3::jsonb, $4::jsonb, $5)`,
        [
          workspaceId,
          'Dev Admin',
          JSON.stringify(makeDocContent('Dev Admin profile')),
          JSON.stringify({
            user_id: devUserId,
            email: 'dev@ship.local',
            capacity_hours: 40,
            skills: ['admin', 'delivery', 'triage'],
          }),
          existingUserIds[0],
        ],
      );
      existingUserIds.push(devUserId);
    } else {
      devUserId = devUserRes.rows[0].id as string;
      await pool.query(
        `UPDATE users
         SET password_hash = $1, is_super_admin = TRUE, updated_at = now()
         WHERE id = $2`,
        [devHash, devUserId],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (workspace_id, user_id)
         DO UPDATE SET role = 'admin', updated_at = now()`,
        [workspaceId, devUserId],
      );
    }

    const deficitUsers = Math.max(0, TARGETS.users - initialCounts.users);
    const deficitIssues = Math.max(0, TARGETS.issues - initialCounts.issues);
    const deficitSprints = Math.max(0, TARGETS.sprints - initialCounts.sprints);

    const currentDocs = initialCounts.documents;
    const minDocsFromRequired =
      currentDocs + deficitUsers + deficitIssues + deficitSprints;
    const deficitDocuments = Math.max(
      0,
      TARGETS.documents - minDocsFromRequired,
    );

    console.log('Planned inserts:', {
      users: deficitUsers,
      issues: deficitIssues,
      sprints: deficitSprints,
      additionalDocs: deficitDocuments,
    });

    await pool.query('BEGIN');

    const newUserIds: string[] = [];
    if (deficitUsers > 0) {
      const hash = await bcrypt.hash('admin123', 10);
      const seedTag = `${Date.now()}`;

      for (let i = 0; i < deficitUsers; i += 1) {
        const userId = randomUUID();
        const idx = initialCounts.users + i + 1;
        const email = `seed.user.${seedTag}.${idx}@ship.local`;
        const fullName = `Seed User ${idx}`;

        await pool.query(
          `INSERT INTO users (id, email, password_hash, name, is_super_admin)
           VALUES ($1, $2, $3, $4, FALSE)`,
          [userId, email, hash, fullName],
        );

        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [workspaceId, userId],
        );

        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
           VALUES ($1, 'person', $2, $3::jsonb, $4::jsonb, $5)`,
          [
            workspaceId,
            fullName,
            JSON.stringify(makeDocContent(`${fullName} profile`)),
            JSON.stringify({
              user_id: userId,
              email,
              capacity_hours: 35 + (i % 6),
              skills: ['delivery', 'analysis', 'communication'].slice(
                0,
                1 + (i % 3),
              ),
            }),
            existingUserIds[0],
          ],
        );

        newUserIds.push(userId);
      }
    }

    const allUserIds = [...existingUserIds, ...newUserIds];

    if (deficitSprints > 0) {
      const now = new Date();
      for (let i = 0; i < deficitSprints; i += 1) {
        const start = new Date(now);
        start.setDate(now.getDate() - i * 14);
        const end = new Date(start);
        end.setDate(start.getDate() + 13);
        const sprintNumber = initialCounts.sprints + i + 1;
        const title = `Sprint ${sprintNumber}`;

        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
           VALUES ($1, 'sprint', $2, $3::jsonb, $4::jsonb, $5)`,
          [
            workspaceId,
            title,
            JSON.stringify(makeDocContent(`${title} goals and scope`)),
            JSON.stringify({
              sprint_status: i % 4 === 0 ? 'closed' : 'active',
              start_date: start.toISOString().slice(0, 10),
              end_date: end.toISOString().slice(0, 10),
              plan: `Focus on reliability and throughput improvements for cycle ${sprintNumber}.`,
            }),
            randomItem(allUserIds),
          ],
        );
      }
    }

    if (deficitIssues > 0) {
      for (let i = 0; i < deficitIssues; i += 1) {
        const issueNumber = initialCounts.issues + i + 1;
        const title = `Seeded issue ${issueNumber}: ${randomItem([
          'Resolve API timeout',
          'Improve navigation clarity',
          'Fix sync conflict edge case',
          'Backfill test coverage',
          'Optimize weekly report query',
        ])}`;
        const state = randomItem(ISSUE_STATES);
        const priority = randomItem(ISSUE_PRIORITIES);
        const assigneeId = randomItem(allUserIds);

        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
           VALUES ($1, 'issue', $2, $3::jsonb, $4::jsonb, $5)`,
          [
            workspaceId,
            title,
            JSON.stringify(makeDocContent(`Issue ${issueNumber} details`)),
            JSON.stringify({
              state,
              priority,
              assignee_id: assigneeId,
              source: 'seed-realistic',
            }),
            assigneeId,
          ],
        );
      }
    }

    if (deficitDocuments > 0) {
      for (let i = 0; i < deficitDocuments; i += 1) {
        const topic = randomItem(WIKI_TOPICS);
        const title = `${topic} ${i + 1}`;
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by)
           VALUES ($1, 'wiki', $2, $3::jsonb, $4::jsonb, $5)`,
          [
            workspaceId,
            title,
            JSON.stringify(makeDocContent(`${topic} overview`)),
            JSON.stringify({
              category: 'knowledge',
              tags: ['seeded', 'reference', 'ops'],
            }),
            randomItem(allUserIds),
          ],
        );
      }
    }

    await pool.query('COMMIT');

    const finalCounts = await getCounts(pool, workspaceId);
    console.log('Final counts:', finalCounts);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
