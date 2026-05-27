import { pool } from '../db/client.js';

const HISTORY_WINDOW_DAYS = 30;
const CONTEXT_QUERY_TIMEOUT_MS = Number(process.env.FLEETGRAPH_CONTEXT_QUERY_TIMEOUT_MS ?? 4000);
const HISTORY_LIMIT = Number(process.env.FLEETGRAPH_HISTORY_LIMIT ?? 300);

async function queryWithTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), CONTEXT_QUERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function loadViewContext(documentType: string, documentId: string): Promise<Record<string, unknown>> {
  try {
    const docResult = await queryWithTimeout(
      pool.query(
        `SELECT id, workspace_id, document_type, title, content, properties, updated_at
         FROM documents
         WHERE id = $1 AND document_type = $2`,
        [documentId, documentType]
      ),
      'fleetgraph_context_document_query'
    );

    if (docResult.rowCount === 0) {
      return { document: null, history: [] };
    }

    const historyResult = await queryWithTimeout(
      pool.query(
        `SELECT field, old_value, new_value, created_at AS changed_at
         FROM document_history
         WHERE document_id = $1
           AND created_at >= now() - interval '${HISTORY_WINDOW_DAYS} days'
         ORDER BY created_at DESC
         LIMIT $2`,
        [documentId, HISTORY_LIMIT]
      ),
      'fleetgraph_context_history_query'
    );

    return {
      document: docResult.rows[0],
      history: historyResult.rows,
      historyWindowDays: HISTORY_WINDOW_DAYS,
      historyLimit: HISTORY_LIMIT,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[FleetGraph] Failed to load view context, using degraded mode:', message);
    return {
      document: null,
      history: [],
      historyWindowDays: HISTORY_WINDOW_DAYS,
      historyLimit: HISTORY_LIMIT,
      degraded: true,
      degradedReason: message,
    };
  }
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
