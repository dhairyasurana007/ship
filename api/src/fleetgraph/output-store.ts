import { pool } from '../db/client.js';
import type { FleetGraphCondition } from './types.js';
import type { FleetGraphOutputMessage } from './notifications.js';

interface RecipientContext {
  assigneeId?: string | null;
  projectOwnerId?: string | null;
  workspaceAdminIds: string[];
}

async function loadRecipientContext(workspaceId: string, issueId: string): Promise<RecipientContext> {
  const issueResult = await pool.query(
    `SELECT
      d.properties->>'assignee_id' AS assignee_id,
      p.created_by::text AS project_owner_id
     FROM documents d
     LEFT JOIN document_associations project_assoc
       ON project_assoc.document_id = d.id AND project_assoc.relationship_type = 'project'
     LEFT JOIN documents p
       ON p.id = project_assoc.related_id
     WHERE d.id = $1
       AND d.workspace_id = $2
     LIMIT 1`,
    [issueId, workspaceId]
  );

  const adminResult = await pool.query(
    `SELECT user_id::text
     FROM workspace_memberships
     WHERE workspace_id = $1
       AND role = 'admin'`,
    [workspaceId]
  );

  return {
    assigneeId: issueResult.rows[0]?.assignee_id ? String(issueResult.rows[0].assignee_id) : null,
    projectOwnerId: issueResult.rows[0]?.project_owner_id ? String(issueResult.rows[0].project_owner_id) : null,
    workspaceAdminIds: adminResult.rows.map((r) => String(r.user_id)),
  };
}

function buildMessage(condition: FleetGraphCondition): string {
  switch (condition.type) {
    case 'stale_issue':
      return `Issue has not progressed recently (${condition.details.staleHours ?? 'unknown'}h stale).`;
    case 'sprint_scope_creep':
      return 'Issue appears to be added to sprint after sprint start window.';
    case 'unresolved_blocker':
      return `Issue appears blocked for ${condition.details.blockerAgeHours ?? 'unknown'}h.`;
    case 'orphaned_issue':
      return `Issue has no assignee and no sprint (${condition.details.orphanAgeDays ?? 'unknown'} days old).`;
    default:
      return 'FleetGraph detected a project health condition.';
  }
}

async function resolveRecipients(condition: FleetGraphCondition): Promise<string[]> {
  const ctx = await loadRecipientContext(condition.workspaceId, condition.entityId);
  if (condition.type === 'stale_issue' && ctx.assigneeId) return [ctx.assigneeId];
  if (condition.type === 'sprint_scope_creep' && ctx.projectOwnerId) return [ctx.projectOwnerId];
  if (condition.type === 'unresolved_blocker') {
    if (ctx.assigneeId && ctx.projectOwnerId && ctx.assigneeId !== ctx.projectOwnerId) {
      return [ctx.assigneeId, ctx.projectOwnerId];
    }
    if (ctx.assigneeId) return [ctx.assigneeId];
    if (ctx.projectOwnerId) return [ctx.projectOwnerId];
  }
  if (condition.type === 'orphaned_issue') {
    if (ctx.projectOwnerId) return [ctx.projectOwnerId];
    return ctx.workspaceAdminIds;
  }
  return [];
}

export async function persistFleetGraphOutputs(
  runId: string,
  workspaceId: string,
  conditions: FleetGraphCondition[],
  outputs: FleetGraphOutputMessage[]
): Promise<void> {
  if (conditions.length === 0 || outputs.length === 0) return;

  for (const condition of conditions) {
    const mappedOutput = outputs.find((o) => o.conditions.includes(condition.type));
    if (!mappedOutput) continue;
    const recipients = await resolveRecipients(condition);
    const message = mappedOutput.message || buildMessage(condition);

    if (recipients.length === 0) {
      await pool.query(
        `INSERT INTO fleetgraph_outputs (
          workspace_id, run_id, condition_type, output_kind, entity_id, entity_type, recipient_user_id, title, message, metadata
        ) VALUES ($1, $2, $3, $4, $5::uuid, $6, NULL, $7, $8, $9::jsonb)
        ON CONFLICT (workspace_id, condition_type, entity_id, recipient_user_id) DO NOTHING`,
        [
          workspaceId,
          runId,
          condition.type,
          mappedOutput.kind,
          condition.entityId,
          'issue',
          mappedOutput.title,
          message,
          JSON.stringify({ severity: condition.severity, details: condition.details }),
        ]
      );
      continue;
    }

    for (const recipientUserId of recipients) {
      await pool.query(
        `INSERT INTO fleetgraph_outputs (
          workspace_id, run_id, condition_type, output_kind, entity_id, entity_type, recipient_user_id, title, message, metadata
        ) VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::uuid, $8, $9, $10::jsonb)
        ON CONFLICT (workspace_id, condition_type, entity_id, recipient_user_id) DO NOTHING`,
        [
          workspaceId,
          runId,
          condition.type,
          mappedOutput.kind,
          condition.entityId,
          'issue',
          recipientUserId,
          mappedOutput.title,
          message,
          JSON.stringify({ severity: condition.severity, details: condition.details }),
        ]
      );
    }
  }
}

export async function listFleetGraphOutputsForWorkspace(workspaceId: string, userId: string): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT id, run_id, condition_type, output_kind, entity_id, entity_type, recipient_user_id, title, message, metadata, created_at
     FROM fleetgraph_outputs
     WHERE workspace_id = $1
       AND (recipient_user_id IS NULL OR recipient_user_id = $2::uuid)
       AND dismissed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 100`,
    [workspaceId, userId]
  );
  return result.rows;
}

export async function dismissFleetGraphOutput(id: string, workspaceId: string): Promise<void> {
  await pool.query(
    `UPDATE fleetgraph_outputs SET dismissed_at = now() WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
}

export async function dismissAllFleetGraphOutputs(workspaceId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE fleetgraph_outputs SET dismissed_at = now()
     WHERE workspace_id = $1
       AND (recipient_user_id IS NULL OR recipient_user_id = $2::uuid)
       AND dismissed_at IS NULL`,
    [workspaceId, userId]
  );
}

export async function createFleetGraphOutput(input: {
  workspaceId: string;
  runId: string;
  conditionType: string;
  outputKind: 'notification' | 'action_required' | 'digest';
  entityId?: string | null;
  recipientUserId?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_outputs (
      workspace_id, run_id, condition_type, output_kind, entity_id, entity_type, recipient_user_id, title, message, metadata
    ) VALUES ($1, $2, $3, $4, $5::uuid, 'issue', $6::uuid, $7, $8, $9::jsonb)`,
    [
      input.workspaceId,
      input.runId,
      input.conditionType,
      input.outputKind,
      input.entityId ?? null,
      input.recipientUserId ?? null,
      input.title,
      input.message,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}
