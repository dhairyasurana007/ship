import { pool } from '../db/client.js';

export type FleetGraphMutationType = 'reassign_issue' | 'move_issue_sprint' | 'change_issue_state';
export type FleetGraphApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';

const TTL_HOURS = 24;

export async function createApprovalRequest(input: {
  workspaceId: string;
  runId: string;
  entityId?: string;
  mutationType: FleetGraphMutationType;
  mutationPayload: Record<string, unknown>;
  requestedBy?: string;
}): Promise<string> {
  const result = await pool.query(
    `INSERT INTO fleetgraph_approval_requests (
      workspace_id, run_id, entity_id, mutation_type, mutation_payload, status, requested_by, expires_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, now() + interval '24 hours')
    RETURNING id`,
    [
      input.workspaceId,
      input.runId,
      input.entityId ?? null,
      input.mutationType,
      JSON.stringify(input.mutationPayload),
      input.requestedBy ?? null,
    ]
  );
  return String(result.rows[0].id);
}

export async function updateApprovalStatus(id: string, status: Exclude<FleetGraphApprovalStatus, 'executed'>, approvedBy?: string): Promise<void> {
  await pool.query(
    `UPDATE fleetgraph_approval_requests
     SET status = $2, approved_by = $3, updated_at = now()
     WHERE id = $1`,
    [id, status, approvedBy ?? null]
  );
}

export async function executeApprovedMutation(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE fleetgraph_approval_requests
     SET status = 'executed', updated_at = now()
     WHERE id = $1
       AND status = 'approved'
       AND expires_at > now()
     RETURNING id`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sweepExpiredApprovals(): Promise<number> {
  const result = await pool.query(
    `UPDATE fleetgraph_approval_requests
     SET status = 'expired', updated_at = now()
     WHERE status = 'pending'
       AND expires_at <= now()`
  );
  return result.rowCount ?? 0;
}

export function approvalTtlHours(): number {
  return TTL_HOURS;
}
