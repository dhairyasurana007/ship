import { pool } from '../db/client.js';

export interface FleetGraphStateRecord {
  value: Record<string, unknown>;
  updatedAt: string;
}

export async function getFleetGraphState(workspaceId: string, projectId: string, key: string): Promise<FleetGraphStateRecord | null> {
  const result = await pool.query(
    `SELECT value, updated_at FROM fleetgraph_state
     WHERE workspace_id = $1 AND project_id = $2 AND key = $3`,
    [workspaceId, projectId, key]
  );
  if (result.rowCount === 0) return null;
  return {
    value: (result.rows[0]?.value ?? {}) as Record<string, unknown>,
    updatedAt: new Date(result.rows[0].updated_at as string).toISOString(),
  };
}

export async function upsertFleetGraphState(workspaceId: string, projectId: string, key: string, value: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_state (workspace_id, project_id, key, value)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (workspace_id, project_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [workspaceId, projectId, key, JSON.stringify(value)]
  );
}

