import { pool } from '../client.js';
import { loadProductionSecrets } from '../../config/ssm.js';

interface WorkspaceRow {
  id: string;
  name: string;
  sprint_start_date: string;
}

function isoDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function buildContent(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Auto-seeded deployment sprint. This sprint is intentionally due within one day to support testing workflows.',
          },
        ],
      },
    ],
  };
}

function computeSprintNumber(workspaceStartDate: string, today = new Date()): number {
  const start = new Date(`${workspaceStartDate}T00:00:00.000Z`);
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayDiff = Math.floor((now.getTime() - start.getTime()) / msPerDay);
  return Math.max(1, Math.floor(dayDiff / 7) + 1);
}

async function upsertDueSoonSprint(workspace: WorkspaceRow): Promise<void> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const sprintNumber = computeSprintNumber(workspace.sprint_start_date, today);
  const title = `Deployment Verification Sprint (Due ${isoDate(tomorrow)})`;
  const content = buildContent();
  const properties = {
    sprint_number: sprintNumber,
    status: 'active',
    start_date: isoDate(today),
    end_date: isoDate(tomorrow),
    auto_seed_due_soon: true,
    auto_seed_source: 'deploy_hook',
    auto_seed_updated_at: new Date().toISOString(),
  };

  const existing = await pool.query<{ id: string }>(
    `SELECT id
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND archived_at IS NULL
       AND deleted_at IS NULL
       AND COALESCE(properties->>'auto_seed_due_soon', 'false') = 'true'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [workspace.id]
  );

  if ((existing.rowCount ?? 0) > 0) {
    const id = existing.rows[0]!.id;
    await pool.query(
      `UPDATE documents
       SET title = $2,
           content = $3::jsonb,
           properties = COALESCE(properties, '{}'::jsonb) || $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [id, title, JSON.stringify(content), JSON.stringify(properties)]
    );
    console.log(`Updated due-soon sprint for workspace ${workspace.name} (${workspace.id})`);
    return;
  }

  await pool.query(
    `INSERT INTO documents (
      workspace_id,
      document_type,
      title,
      content,
      properties
    ) VALUES ($1, 'sprint', $2, $3::jsonb, $4::jsonb)`,
    [workspace.id, title, JSON.stringify(content), JSON.stringify(properties)]
  );
  console.log(`Created due-soon sprint for workspace ${workspace.name} (${workspace.id})`);
}

async function seedDueSoonSprints(): Promise<void> {
  await loadProductionSecrets();

  const workspaces = await pool.query<WorkspaceRow>(
    `SELECT id, name, sprint_start_date::text
     FROM workspaces
     WHERE archived_at IS NULL`
  );

  if ((workspaces.rowCount ?? 0) === 0) {
    console.log('No workspaces found. Skipping due-soon sprint seed.');
    return;
  }

  for (const workspace of workspaces.rows) {
    await upsertDueSoonSprint(workspace);
  }
}

seedDueSoonSprints()
  .then(async () => {
    await pool.end();
    console.log('Due-soon sprint seed complete.');
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Due-soon sprint seed failed:', error);
    await pool.end();
    process.exit(1);
  });
