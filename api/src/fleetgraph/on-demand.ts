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

async function resolveHistoryTimestampColumn(): Promise<'changed_at' | 'created_at'> {
  try {
    const result = await queryWithTimeout(
      pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'document_history'
           AND column_name IN ('changed_at', 'created_at')`
      ),
      'fleetgraph_context_history_column_query'
    );
    const names = new Set(result.rows.map((row: { column_name: string }) => row.column_name));
    if (names.has('changed_at')) return 'changed_at';
    return 'created_at';
  } catch {
    return 'created_at';
  }
}

export async function loadViewContext(documentType: string, documentId: string): Promise<Record<string, unknown>> {
  try {
    const historyTimestampColumn = await resolveHistoryTimestampColumn();
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
        `SELECT field, old_value, new_value, ${historyTimestampColumn} AS changed_at
         FROM document_history
         WHERE document_id = $1
           AND ${historyTimestampColumn} >= now() - interval '${HISTORY_WINDOW_DAYS} days'
         ORDER BY ${historyTimestampColumn} DESC
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
  const doc = (context.document ?? null) as
    | { title?: string; document_type?: string; updated_at?: string | Date | null }
    | null;
  const history = Array.isArray(context.history) ? context.history : [];
  const docType = doc?.document_type ? String(doc.document_type) : 'document';
  const docTitle = doc?.title ? String(doc.title) : 'Untitled';
  const updatedAtText = doc?.updated_at ? new Date(doc.updated_at).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }) : null;

  const summary = doc
    ? `This ${docType} appears to be "${docTitle}"${updatedAtText ? ` (last updated ${updatedAtText})` : ''}. I found ${history.length} history changes in the last ${HISTORY_WINDOW_DAYS} days.`
    : 'I could not load the current document context. Please verify the document exists and try again.';

  return {
    model: 'gpt-4o-mini',
    summary,
    prompt,
    contextLoaded: Boolean(context.document),
    historyCount: history.length,
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
