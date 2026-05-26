import { pool } from '../db/client.js';
import type { FleetGraphIssueRecord } from './types.js';

export async function loadProjectContext(_workspaceId: string): Promise<Record<string, unknown>> {
  return {};
}

export async function fetchIssues(workspaceId: string): Promise<FleetGraphIssueRecord[]> {
  const result = await pool.query(
    `SELECT
      d.id,
      d.workspace_id,
      d.updated_at,
      d.created_at,
      d.content::text ILIKE '%blocker%' AS has_blocker_text,
      d.properties->>'state' AS state,
      sprint.related_id AS sprint_id,
      project.related_id AS project_id
     FROM documents d
     LEFT JOIN document_associations sprint
       ON sprint.document_id = d.id AND sprint.relationship_type = 'week'
     LEFT JOIN document_associations project
       ON project.document_id = d.id AND project.relationship_type = 'project'
     WHERE d.workspace_id = $1
       AND d.document_type = 'issue'`,
    [workspaceId]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    state: row.state ? String(row.state) : null,
    sprintId: row.sprint_id ? String(row.sprint_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    hasBlockerText: Boolean(row.has_blocker_text),
    blockerUpdatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }));
}

export async function fetchSprintState(_workspaceId: string): Promise<Record<string, unknown>> {
  return {};
}

export async function fetchTeamState(_workspaceId: string): Promise<Record<string, unknown>> {
  return {};
}

