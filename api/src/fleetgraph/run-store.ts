import { pool } from '../db/client.js';
import type { FleetGraphRunEnvelope, FleetGraphRunStatus } from './types.js';

export async function insertFleetGraphRun(envelope: FleetGraphRunEnvelope, status: FleetGraphRunStatus): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_runs (
      run_id, trigger_type, status, workspace_id, entity_id, entity_type, payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      envelope.runId,
      envelope.triggerType,
      status,
      envelope.workspaceId ?? null,
      envelope.entityId ?? null,
      envelope.entityType ?? null,
      JSON.stringify(envelope.payload),
    ]
  );
}

export async function updateFleetGraphRunStatus(runId: string, status: FleetGraphRunStatus, errorMessage?: string): Promise<void> {
  const nowField = status === 'running' ? 'started_at' : status === 'completed' || status === 'failed' || status === 'skipped' ? 'completed_at' : null;
  if (nowField) {
    await pool.query(
      `UPDATE fleetgraph_runs
       SET status = $2, error_message = $3, updated_at = now(), ${nowField} = now()
       WHERE run_id = $1`,
      [runId, status, errorMessage ?? null]
    );
    return;
  }

  await pool.query(
    `UPDATE fleetgraph_runs
     SET status = $2, error_message = $3, updated_at = now()
     WHERE run_id = $1`,
    [runId, status, errorMessage ?? null]
  );
}

