import { pool } from '../db/client.js';

export type FleetGraphToolName = 'create_document' | 'update_document' | 'delete_document';

export interface FleetGraphToolCall {
  name: FleetGraphToolName;
  args: Record<string, unknown>;
}

export interface FleetGraphToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

function extractQuoted(prompt: string): string | null {
  const match = prompt.match(/"([^"]+)"/);
  return match?.[1] ?? null;
}

function extractDocType(promptLower: string): string {
  if (promptLower.includes('issue')) return 'issue';
  if (promptLower.includes('project')) return 'project';
  if (promptLower.includes('program')) return 'program';
  if (promptLower.includes('sprint') || promptLower.includes('week')) return 'sprint';
  if (promptLower.includes('standup')) return 'standup';
  return 'wiki';
}

export function inferToolCallFromPrompt(input: {
  prompt: string;
  contextScope: 'workspace' | 'document';
  documentId?: string;
}): FleetGraphToolCall | null {
  const prompt = input.prompt.trim();
  const lower = prompt.toLowerCase();
  const inDocumentScope = input.contextScope === 'document' && Boolean(input.documentId);
  const hasDocNoun = /(document|doc|issue|project|program|sprint|week|standup|wiki)/.test(lower);

  if (/(create|add|new)\s+/.test(lower) && hasDocNoun) {
    const title = extractQuoted(prompt) ?? 'Untitled';
    return {
      name: 'create_document',
      args: {
        documentType: extractDocType(lower),
        title,
      },
    };
  }

  if (/(delete|remove)\s+/.test(lower) && (hasDocNoun || inDocumentScope)) {
    const docId = input.contextScope === 'document' ? input.documentId : null;
    if (!docId) return null;
    return {
      name: 'delete_document',
      args: { documentId: docId },
    };
  }

  if (/(update|edit|modify|rename|change)\s+/.test(lower) && (hasDocNoun || inDocumentScope)) {
    const docId = input.contextScope === 'document' ? input.documentId : null;
    if (!docId) return null;
    const title = (/title/.test(lower) || /rename/.test(lower)) ? extractQuoted(prompt) : null;
    const contentText = /(content|text|body)/.test(lower) ? extractQuoted(prompt) : null;
    if (!title && !contentText && lower.includes('clear')) {
      return {
        name: 'update_document',
        args: {
          documentId: docId,
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      };
    }
    return {
      name: 'update_document',
      args: {
        documentId: docId,
        ...(title ? { title } : {}),
        ...(contentText
          ? {
              content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: contentText }] }],
              },
            }
          : {}),
      },
    };
  }

  return null;
}

export async function executeToolCall(input: {
  workspaceId: string;
  userId: string;
  toolCall: FleetGraphToolCall;
}): Promise<FleetGraphToolResult> {
  const { workspaceId, userId, toolCall } = input;

  if (toolCall.name === 'create_document') {
    const documentType = String(toolCall.args.documentType ?? 'wiki');
    const title = String(toolCall.args.title ?? 'Untitled');
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, $2::document_type, $3, $4)
       RETURNING id, document_type, title`,
      [workspaceId, documentType, title, userId]
    );
    const row = result.rows[0];
    return {
      ok: true,
      summary: `Created ${row.document_type} document "${row.title}".`,
      data: { documentId: row.id, documentType: row.document_type, title: row.title },
    };
  }

  if (toolCall.name === 'update_document') {
    const documentId = String(toolCall.args.documentId ?? '');
    if (!documentId) return { ok: false, summary: 'Missing documentId for update.' };
    const title = typeof toolCall.args.title === 'string' ? toolCall.args.title : null;
    const content = toolCall.args.content ?? null;

    const existing = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [documentId, workspaceId]
    );
    if (existing.rowCount === 0) return { ok: false, summary: 'Document not found in workspace.' };

    const updates: string[] = ['updated_at = now()'];
    const values: unknown[] = [documentId, workspaceId];
    let idx = 3;
    if (title !== null) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (content !== null) {
      updates.push(`content = $${idx++}::jsonb`);
      values.push(JSON.stringify(content));
    }

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, title`,
      values
    );
    const row = result.rows[0];
    return {
      ok: true,
      summary: `Updated document "${row.title}".`,
      data: { documentId: row.id, title: row.title },
    };
  }

  const documentId = String(toolCall.args.documentId ?? '');
  if (!documentId) return { ok: false, summary: 'Missing documentId for delete.' };

  const result = await pool.query(
    `UPDATE documents
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
     RETURNING id, title`,
    [documentId, workspaceId]
  );
  if (result.rowCount === 0) return { ok: false, summary: 'Document not found or already deleted.' };
  return {
    ok: true,
    summary: `Deleted document "${result.rows[0].title}".`,
    data: { documentId: result.rows[0].id },
  };
}
