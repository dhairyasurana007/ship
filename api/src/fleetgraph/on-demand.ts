import { pool } from '../db/client.js';

const HISTORY_WINDOW_DAYS = 30;

export async function loadViewContext(documentType: string, documentId: string): Promise<Record<string, unknown>> {
  const docResult = await pool.query(
    `SELECT id, workspace_id, document_type, title, content, properties, updated_at
     FROM documents
     WHERE id = $1 AND document_type = $2`,
    [documentId, documentType]
  );

  if (docResult.rowCount === 0) {
    return { document: null, history: [] };
  }

  const historyResult = await pool.query(
    `SELECT field, old_value, new_value, changed_at
     FROM document_history
     WHERE document_id = $1
       AND changed_at >= now() - interval '${HISTORY_WINDOW_DAYS} days'
     ORDER BY changed_at DESC`,
    [documentId]
  );

  return {
    document: docResult.rows[0],
    history: historyResult.rows,
    historyWindowDays: HISTORY_WINDOW_DAYS,
  };
}

export function reasonOnContext(context: Record<string, unknown>, prompt: string): Record<string, unknown> {
  return {
    model: 'gpt-4o-mini',
    summary: `Analyzed context for prompt: ${prompt}`,
    contextLoaded: Boolean(context.document),
    historyCount: Array.isArray(context.history) ? context.history.length : 0,
  };
}

export function generateResponse(
  reasoning: Record<string, unknown>,
  opts: { requiresMutationConfirm: boolean; explicitConfirm?: boolean }
): Record<string, unknown> {
  if (opts.requiresMutationConfirm && !opts.explicitConfirm) {
    return {
      response: 'Action proposed. Explicit confirm is required before mutation.',
      requiresConfirm: true,
    };
  }

  return {
    response: reasoning.summary,
    requiresConfirm: false,
  };
}

