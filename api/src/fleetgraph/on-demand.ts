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
- Answer the user's question directly and concisely before providing any supporting detail.
- Base all responses strictly on the provided context. Do not infer, assume, or fabricate data that is not present.
- If relevant data is missing or outside the provided context window, explicitly state what is missing and why it limits your answer.
- If you are uncertain about a finding, say so — qualify the statement with the degree of confidence (e.g. "likely", "possibly", "insufficient data to confirm").
- When proposing actions, present them as a numbered list of recommended steps. Do not imply any action has been taken unless it is explicitly confirmed in the context.
- For mutation requests (reassigning issues, changing state, moving sprints), outline the proposed change and require explicit human approval before treating it as accepted.
- Keep responses professional, direct, and free of filler phrases.

## Constraints
- Never claim an action was executed unless the context explicitly confirms it.
- Never act on data outside the provided context — do not retrieve, guess, or hallucinate external state.
- Never approve or execute a mutation on behalf of the user.
- If asked something outside the scope of project management within Ship, politely decline and redirect to what you can help with.

## Examples

### Example 1 — Workspace query
**User:** What is the overall health of the workspace right now?
**Assistant:**
Based on the provided context, 3 of 5 active sprints are on track. Two sprints are at risk:
- **Alpha v2** — 4 issues stale for 3+ days, sprint ends in 2 days.
- **Onboarding Redesign** — scope increased by 2 issues post-start date.

Recommended next steps:
1. Review the 4 stale issues in Alpha v2 and reassign or descope before the sprint closes.
2. Confirm whether the 2 post-start additions to Onboarding Redesign are formally accepted scope changes.

*Note: team capacity data was not included in this context window — capacity risk cannot be assessed.*

### Example 2 — Document query
**User:** Is this issue blocked?
**Assistant:**
Based on the issue content and history provided, there are indicators of a potential blocker — the description references "waiting on auth team response" — however the issue state is currently \`in_progress\`, not \`blocked\`. Confidence: moderate.

If this is an active dependency, recommended steps:
1. Update the issue state to \`blocked\` to trigger escalation tracking.
2. Tag the auth team owner as a dependency.

No mutations have been made. Your approval is required before any changes are applied.
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
export async function callLlmForToolSelection(
  config: FleetGraphConfig | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<FleetGraphToolCall | null> {
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
        tool_choice: 'auto',
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
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const toolCall = payload.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.name) return null;

    const name = toolCall.function.name as FleetGraphToolName;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(toolCall.function.arguments ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }

    return { name, args };
  } catch {
    return null;
  }
}

async function callLlm(config: FleetGraphConfig | undefined, systemPrompt: string, userPrompt: string): Promise<string | null> {
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

  if (context.scope === 'workspace') {
    const promptLower = prompt.toLowerCase();
    const openIssueCount = Number(context.openIssueCount ?? 0);
    const activeSprintCount = Number(context.activeSprintCount ?? 0);
    const recentDocuments = Array.isArray(context.recentDocuments) ? context.recentDocuments : [];
    const recentTitles = recentDocuments
      .slice(0, 3)
      .map((doc) => (doc as { title?: string }).title)
      .filter(Boolean) as string[];
    const sampleTitles = recentTitles.join(', ');

    let summary = '';
    if (/(how many|count|open issues|issue count)/.test(promptLower)) {
      summary = `There are currently ${openIssueCount} open issues in this workspace.`;
    } else if (/(active sprint|sprint count|how many sprints|current sprint)/.test(promptLower)) {
      summary = `There are currently ${activeSprintCount} active sprints in this workspace.`;
    } else if (/(recent|latest|updated|what docs|documents)/.test(promptLower)) {
      summary = recentTitles.length > 0
        ? `Recent documents: ${sampleTitles}.`
        : 'No recent documents were found in this workspace.';
    } else if (/(what is this about|summary|overview|status)/.test(promptLower)) {
      summary =
        `Workspace status: ${openIssueCount} open issues and ${activeSprintCount} active sprints. ` +
        `${sampleTitles ? `Recent docs include: ${sampleTitles}.` : 'No recent documents were found.'}`;
    } else {
      summary =
        `I used workspace-level context for your request. Current status: ${openIssueCount} open issues, ` +
        `${activeSprintCount} active sprints${sampleTitles ? `, and recent docs: ${sampleTitles}` : ''}. ` +
        `If you want a specific slice, ask for counts, recent documents, or sprint status.`;
    }

    const fallbackSummary = summary;
    const llmSummary = await callLlm(config, systemPrompt, userPrompt);
    const llmUsed = Boolean(llmSummary);
    return {
      model: 'gpt-4o-mini',
      summary: llmSummary ?? fallbackSummary,
      llmUsed,
      llmSummary: llmSummary ?? null,
      provider: config?.provider ?? null,
      systemPrompt,
      userPrompt,
      prompt,
      contextLoaded: true,
      historyCount: 0,
    };
  }

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

  const llmSummary = await callLlm(config, systemPrompt, userPrompt);
  const llmUsed = Boolean(llmSummary);
  return {
    model: 'gpt-4o-mini',
    summary: llmSummary ?? summary,
    llmUsed,
    llmSummary: llmSummary ?? null,
    provider: config?.provider ?? null,
    systemPrompt,
    userPrompt,
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
