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
      d.title,
      d.updated_at,
      d.created_at,
      d.content::text ILIKE '%blocker%' AS has_blocker_text,
      d.properties->>'state' AS state,
      d.properties->>'assignee_id' AS assignee_id,
      sprint.related_id AS sprint_id,
      sprint_doc.title AS sprint_title,
      project.related_id AS project_id,
      project_doc.title AS project_title,
      u.name AS assignee_name
     FROM documents d
     LEFT JOIN document_associations sprint
       ON sprint.document_id = d.id AND sprint.relationship_type = 'sprint'
     LEFT JOIN documents sprint_doc ON sprint_doc.id = sprint.related_id
     LEFT JOIN document_associations project
       ON project.document_id = d.id AND project.relationship_type = 'project'
     LEFT JOIN documents project_doc ON project_doc.id = project.related_id
     LEFT JOIN users u ON u.id = (d.properties->>'assignee_id')::uuid
     WHERE d.workspace_id = $1
       AND d.document_type = 'issue'`,
    [workspaceId]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: row.title ? String(row.title) : null,
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    state: row.state ? String(row.state) : null,
    sprintId: row.sprint_id ? String(row.sprint_id) : null,
    sprintTitle: row.sprint_title ? String(row.sprint_title) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    projectTitle: row.project_title ? String(row.project_title) : null,
    hasBlockerText: Boolean(row.has_blocker_text),
    blockerUpdatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }));
}


