import { pool } from '../db/client.js';
import type { FleetGraphConfig } from './types.js';

const HISTORY_WINDOW_DAYS = 30;
const CONTEXT_QUERY_TIMEOUT_MS = Number(process.env.FLEETGRAPH_CONTEXT_QUERY_TIMEOUT_MS ?? 4000);
const HISTORY_LIMIT = Number(process.env.FLEETGRAPH_HISTORY_LIMIT ?? 300);
const LLM_TIMEOUT_MS = Number(process.env.FLEETGRAPH_LLM_TIMEOUT_MS ?? 12000);

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

export async function loadWorkspaceContext(workspaceId: string): Promise<Record<string, unknown>> {
  try {
    const [docsResult, openIssuesResult, activeSprintsResult] = await Promise.all([
      queryWithTimeout(
        pool.query(
          `SELECT id, document_type, title, updated_at
           FROM documents
           WHERE workspace_id = $1
             AND archived_at IS NULL
             AND deleted_at IS NULL
           ORDER BY updated_at DESC
           LIMIT 12`,
          [workspaceId]
        ),
        'fleetgraph_workspace_docs_query'
      ),
      queryWithTimeout(
        pool.query(
          `SELECT COUNT(*)::int AS open_issue_count
           FROM documents
           WHERE workspace_id = $1
             AND document_type = 'issue'
             AND archived_at IS NULL
             AND deleted_at IS NULL
             AND COALESCE(properties->>'state', 'todo') NOT IN ('done', 'cancelled')`,
          [workspaceId]
        ),
        'fleetgraph_workspace_open_issues_query'
      ),
      queryWithTimeout(
        pool.query(
          `SELECT COUNT(*)::int AS active_sprint_count
           FROM documents
           WHERE workspace_id = $1
             AND document_type = 'sprint'
             AND archived_at IS NULL
             AND deleted_at IS NULL
             AND COALESCE(properties->>'status', 'planning') = 'active'`,
          [workspaceId]
        ),
        'fleetgraph_workspace_active_sprints_query'
      ),
    ]);

    return {
      scope: 'workspace',
      recentDocuments: docsResult.rows,
      openIssueCount: openIssuesResult.rows[0]?.open_issue_count ?? 0,
      activeSprintCount: activeSprintsResult.rows[0]?.active_sprint_count ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[FleetGraph] Failed to load workspace context, using degraded mode:', message);
    return {
      scope: 'workspace',
      recentDocuments: [],
      openIssueCount: 0,
      activeSprintCount: 0,
      degraded: true,
      degradedReason: message,
    };
  }
}

export function buildSystemPrompt(scope: 'workspace' | 'document'): string {
  const base = `
## Role
You are FleetGraph, Ship's project intelligence assistant. You are embedded directly in the Ship project management platform and operate on behalf of the user currently viewing their workspace or document.

## Purpose
Your purpose is to help project managers, engineers, and directors understand the current state of their work — identifying risks, summarising progress, and proposing concrete next steps — using only the context provided to you in each request.

## Instructions
- Answer the user's question directly and concisely.
- Base all responses strictly on the provided context. Do not infer, assume, or fabricate data.
- If relevant data is missing, say so explicitly.
- For mutation requests, outline the proposed change and require explicit human approval before treating it as accepted.
- Keep responses short and direct. No filler phrases, no unsolicited next steps.

## Constraints
- Never claim an action was executed unless the context explicitly confirms it.
- Never act on data outside the provided context.
- Never approve or execute a mutation on behalf of the user.
`.trim();

  if (scope === 'workspace') {
    return `${base}\n\n## Scope\nYou are operating at workspace level. Summarise cross-project status, issue load, sprint posture, and recent activity across all projects in the provided context.`;
  }
  return `${base}\n\n## Scope\nYou are operating at document level. Reason about the current document and its directly related history and context only. Do not make claims about the broader workspace unless that data is explicitly included.`;
}

function buildUserPrompt(
  scope: 'workspace' | 'document',
  prompt: string,
  context: Record<string, unknown>
): string {
  return [
    `User request: ${prompt}`,
    `Context scope: ${scope}`,
    `Context JSON:`,
    JSON.stringify(context),
    'Return a direct answer first, then optional bullets for recommended next actions.',
  ].join('\n\n');
}

import { FLEETGRAPH_TOOL_SCHEMAS } from './tool-schemas.js';
import type { FleetGraphToolCall, FleetGraphToolName } from './tools.js';

/**
 * Ask the LLM to select a tool (or respond directly).
 * Returns a FleetGraphToolCall if the LLM picked a tool, or null to fall through to text reasoning.
 */
export interface LlmToolSelection {
  toolCall: FleetGraphToolCall;
  toolCallId: string;
  systemPrompt: string;
  userPrompt: string;
}

export async function callLlmForToolSelection(
  config: FleetGraphConfig | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmToolSelection | null> {
  if (!config) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const endpoint = config.provider === 'openrouter'
      ? `${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    const apiKey = config.provider === 'openrouter' ? config.openRouterApiKey : config.openAiApiKey;
    if (!apiKey) return null;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        tools: FLEETGRAPH_TOOL_SCHEMAS,
        tool_choice: 'required',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const payload = await res.json() as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const raw = payload.choices?.[0]?.message?.tool_calls?.[0];
    if (!raw?.function?.name) return null;

    const name = raw.function.name;
    if (name === 'respond_directly') return null;

    let args: Record<string, unknown> = {};
    try { args = JSON.parse(raw.function.arguments ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }

    return {
      toolCall: { name: name as FleetGraphToolName, args },
      toolCallId: raw.id ?? 'call_0',
      systemPrompt,
      userPrompt,
    };
  } catch {
    return null;
  }
}

/**
 * Second leg of the tool-use conversation: send the tool result back to the LLM
 * so it can answer the user's original question using the actual data.
 */
export async function callLlmWithToolResult(
  config: FleetGraphConfig | undefined,
  selection: LlmToolSelection,
  toolName: string,
  toolResultData: unknown,
): Promise<string | null> {
  if (!config) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const endpoint = config.provider === 'openrouter'
      ? `${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    const apiKey = config.provider === 'openrouter' ? config.openRouterApiKey : config.openAiApiKey;
    if (!apiKey) return null;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: selection.systemPrompt },
          { role: 'user', content: selection.userPrompt },
          {
            role: 'assistant',
            tool_calls: [{
              id: selection.toolCallId,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(selection.toolCall.args) },
            }],
          },
          {
            role: 'tool',
            tool_call_id: selection.toolCallId,
            content: JSON.stringify(toolResultData),
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[FleetGraph] callLlmWithToolResult HTTP error:', res.status, errText);
      return null;
    }
    const payload = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    console.log('[FleetGraph] callLlmWithToolResult response:', content?.slice(0, 200));
    return typeof content === 'string' && content.trim() ? content.trim() : null;
  } catch (err) {
    console.error('[FleetGraph] callLlmWithToolResult failed:', err);
    return null;
  }
}

export async function callLlm(config: FleetGraphConfig | undefined, systemPrompt: string, userPrompt: string): Promise<string | null> {
  try {
    if (!config) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const endpoint = config.provider === 'openrouter'
      ? `${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    const apiKey = config.provider === 'openrouter' ? config.openRouterApiKey : config.openAiApiKey;
    if (!apiKey) return null;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const payload = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content.trim() : null;
  } catch {
    return null;
  }
}

export async function reasonOnContext(
  context: Record<string, unknown>,
  prompt: string,
  config?: FleetGraphConfig,
  scope: 'workspace' | 'document' = context.scope === 'workspace' ? 'workspace' : 'document'
): Promise<Record<string, unknown>> {
  const systemPrompt = buildSystemPrompt(scope);
  const userPrompt = buildUserPrompt(scope, prompt, context);

  const history = Array.isArray(context.history) ? context.history : [];
  const llmSummary = await callLlm(config, systemPrompt, userPrompt);
  return {
    model: 'gpt-4o-mini',
    summary: llmSummary ?? 'FleetGraph is unavailable right now. Please check your configuration.',
    llmUsed: Boolean(llmSummary),
    llmSummary: llmSummary ?? null,
    provider: config?.provider ?? null,
    systemPrompt,
    userPrompt,
    prompt,
    contextLoaded: Boolean(context.document ?? context.openIssueCount !== undefined),
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
