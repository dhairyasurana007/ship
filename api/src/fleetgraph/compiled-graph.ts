import crypto from 'crypto';
import { classifyCapacityMismatch, classifyConditions } from './classify-conditions.js';
import { generateResponse, loadViewContext, loadWorkspaceContext, reasonOnContext } from './on-demand.js';
import { fetchIssues, loadProjectContext } from './proactive-context.js';
import { routeOutputs } from './notifications.js';
import { executeToolCall, inferToolCallFromPrompt, type FleetGraphToolCall, type FleetGraphToolResult } from './tools.js';
import { callLlmForToolSelection, callLlmWithToolResult, buildSystemPrompt, callLlm } from './on-demand.js';
import { createLangSmithChildRun, finishLangSmithChildRun } from './langsmith.js';
import type { FleetGraphConfig, FleetGraphCondition } from './types.js';

type ContextScope = 'workspace' | 'document';
type AccessMode = 'ask_permission' | 'full_access';

const MUTATION_TOOL_NAMES = new Set([
  'create_document',
  'update_document',
  'delete_document',
  'delete_documents_by_title',
  'create_project',
  'update_project',
  'archive_project',
  'create_sprint',
  'move_item_to_sprint',
  'close_sprint',
  'update_work_item_fields',
  'link_documents',
  'unlink_documents',
  'bulk_edit_documents',
  'create_comment',
]);

function isMutationToolName(name: string): boolean {
  return MUTATION_TOOL_NAMES.has(name);
}

export interface ProactiveGraphInput {
  mode: 'proactive';
  workspaceId: string;
  parentRunId?: string;
  config?: FleetGraphConfig;
}

export interface OnDemandGraphInput {
  mode: 'on_demand';
  workspaceId: string;
  userId: string;
  prompt: string;
  contextScope: ContextScope;
  accessMode: AccessMode;
  requiresMutationConfirm: boolean;
  explicitConfirm: boolean;
  config: FleetGraphConfig;
  documentType?: string;
  documentId?: string;
  parentRunId?: string;
  history?: Array<{ role: string; content: string }>;
}

export type FleetGraphInvokeInput = ProactiveGraphInput | OnDemandGraphInput;

export interface ProactiveGraphOutput {
  mode: 'proactive';
  conditions: FleetGraphCondition[];
  outputs: ReturnType<typeof routeOutputs>;
  context: {
    project: Record<string, unknown>;
  };
}

export interface OnDemandGraphOutput {
  mode: 'on_demand';
  kind: 'tool_confirm' | 'tool_executed' | 'reasoned';
  contextScope: ContextScope;
  response: string;
  requiresConfirm: boolean;
  degraded: boolean;
  degradedReason: string | null;
  toolCall?: FleetGraphToolCall;
  toolResult?: FleetGraphToolResult;
  reasoning?: Record<string, unknown>;
  contextLoaded?: boolean;
  historyCount?: number;
}

export type FleetGraphInvokeOutput = ProactiveGraphOutput | OnDemandGraphOutput;

/**
 * Returns true when a prompt looks like random keyboard noise rather than a
 * meaningful request — e.g. "a;sldfj;alsfj;aewljr;alkjf".
 *
 * Heuristics (any one triggers):
 *  - Empty or whitespace-only after trimming
 *  - >30 % of non-space chars are non-alphanumeric (punctuation mash)
 *  - String has >10 letters but <10 % are vowels (consonant-only string)
 */
export function looksLikeGibberish(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return true;

  const noSpaces = trimmed.replace(/\s+/g, '');
  if (noSpaces.length === 0) return true;

  // Only count ASCII non-alphanumeric as noise — Unicode letters/digits are valid
  const nonAlphanumericNoise = (noSpaces.match(/[^\p{L}\p{N}]/gu) ?? []).length;
  if (nonAlphanumericNoise / noSpaces.length > 0.3) return true;

  const letters = (noSpaces.match(/[a-zA-Z]/g) ?? []).length;
  const vowels = (noSpaces.match(/[aeiouAEIOU]/g) ?? []).length;
  if (letters > 10 && vowels / letters < 0.1) return true;

  // Long consecutive consonant runs (≥5) appearing 1+ times → keyboard mash.
  // Use the ORIGINAL trimmed string (not noSpaces) so word boundaries are preserved —
  // concatenating spaces-removed words creates false cross-word runs like "recentlydeleted" → ntlyd.
  const longConsonantRuns = (trimmed.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{5,}/g) ?? []).length;
  if (longConsonantRuns >= 1) return true;

  return false;
}


function buildConfirmMessage(toolCall: FleetGraphToolCall): string {
  const name = toolCall.name;
  const args = toolCall.args;
  const title = typeof args.title === 'string' ? `"${args.title}"` : null;
  const docId = typeof args.documentId === 'string' ? args.documentId.substring(0, 8) + '...' : null;
  switch (name) {
    case 'create_document': return `Create ${args.documentType ?? 'document'} titled ${title ?? '"Untitled"'}?`;
    case 'update_document': return `Update document${title ? ` title to ${title}` : ''}${docId ? ` (${docId})` : ''}?`;
    case 'delete_document': return `Delete current document (${docId ?? 'this document'})?`;
    case 'delete_documents_by_title': return `Delete all documents titled ${title ?? '(unknown)'}?`;
    case 'move_item_to_sprint': return `Move issue "${args.issueTitle}" to sprint "${args.targetSprintTitle}"?`;
    case 'close_sprint': return `Close sprint (${docId ?? 'current sprint'})?`;
    case 'create_sprint': return `Create sprint titled ${title ?? '"Untitled"'}?`;
    case 'create_project': return `Create project titled ${title ?? '"Untitled"'}?`;
    case 'archive_project': return `Archive project (${docId ?? 'current project'})?`;
    case 'create_comment': return `Add comment to current document?`;
    case 'update_work_item_fields': return `Update status for "${args.issueTitle}" to "${args.status}"?`;
    case 'bulk_edit_documents': return `Bulk edit documents titled ${title ?? '(unknown)'}?`;
    default: return `Confirm action: ${name}?`;
  }
}

class FleetGraphCompiledGraph {
  async invoke(input: ProactiveGraphInput): Promise<ProactiveGraphOutput>;
  async invoke(input: OnDemandGraphInput): Promise<OnDemandGraphOutput>;
  async invoke(input: FleetGraphInvokeInput): Promise<FleetGraphInvokeOutput> {
    if (input.mode === 'proactive') {
      const projectContext = await loadProjectContext(input.workspaceId);
      const fetchIssuesRunId = crypto.randomUUID();
      const proactiveTracing = input.config && input.parentRunId ? { config: input.config, parentRunId: input.parentRunId } : null;
      if (proactiveTracing) {
        await createLangSmithChildRun(proactiveTracing.config, proactiveTracing.parentRunId, fetchIssuesRunId, 'fetch_issues', { workspaceId: input.workspaceId }, 'chain');
      }
      let issues: Awaited<ReturnType<typeof fetchIssues>>;
      try {
        issues = await fetchIssues(input.workspaceId);
        if (proactiveTracing) {
          await finishLangSmithChildRun(proactiveTracing.config, fetchIssuesRunId, { issueCount: issues.length }, 'completed');
        }
      } catch (err) {
        if (proactiveTracing) {
          await finishLangSmithChildRun(proactiveTracing.config, fetchIssuesRunId, {}, 'failed', err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
      const conditions = [
        ...classifyConditions(issues),
        ...classifyCapacityMismatch(issues),
      ];
      return {
        mode: 'proactive',
        conditions,
        outputs: routeOutputs(conditions),
        context: {
          project: projectContext,
        },
      };
    }

    // LLM-driven tool selection — falls back to regex if no LLM config
    const systemPrompt = buildSystemPrompt(input.contextScope);
    const llmSelection = await callLlmForToolSelection(input.config, systemPrompt, input.prompt, input.history ?? []);
    const toolCall = llmSelection?.toolCall ?? inferToolCallFromPrompt({
      prompt: input.prompt,
      contextScope: input.contextScope,
      documentId: input.contextScope === 'document' ? input.documentId : undefined,
    });

    if (toolCall) {
      const shouldRequireConfirm =
        input.accessMode === 'ask_permission'
          ? isMutationToolName(toolCall.name)
          : input.requiresMutationConfirm;

      if (shouldRequireConfirm && !input.explicitConfirm) {
        return {
          mode: 'on_demand',
          kind: 'tool_confirm',
          contextScope: input.contextScope,
          response: buildConfirmMessage(toolCall),
          requiresConfirm: true,
          degraded: false,
          degradedReason: null,
          toolCall,
        };
      }

      const toolRunId = crypto.randomUUID();
      await createLangSmithChildRun(input.config, input.parentRunId ?? '', toolRunId, `tool.${toolCall.name}`, { toolCall }, 'tool');
      let toolResult: Awaited<ReturnType<typeof executeToolCall>>;
      try {
        toolResult = await executeToolCall({ workspaceId: input.workspaceId, userId: input.userId, toolCall });
        await finishLangSmithChildRun(input.config, toolRunId, { ok: toolResult.ok, summary: toolResult.summary }, toolResult.ok ? 'completed' : 'failed');
      } catch (err) {
        await finishLangSmithChildRun(input.config, toolRunId, {}, 'failed', err instanceof Error ? err.message : String(err));
        throw err;
      }

      // Second leg: send full conversation + tool result back to LLM to answer the user's question
      const toolData = (toolResult as unknown as Record<string, unknown>).data ?? toolResult.summary;
      const llmAnswer = llmSelection
        ? await callLlmWithToolResult(input.config, llmSelection, toolCall.name, toolData)
        : await callLlm(input.config, systemPrompt, `The user asked: "${input.prompt}"\n\nTool result:\n${JSON.stringify(toolData)}\n\nAnswer concisely.`);

      return {
        mode: 'on_demand',
        kind: 'tool_executed',
        contextScope: input.contextScope,
        response: llmAnswer ?? toolResult.summary,
        requiresConfirm: false,
        degraded: false,
        degradedReason: null,
        toolCall,
        toolResult,
      };
    }

    const loadContextRunId = crypto.randomUUID();
    await createLangSmithChildRun(input.config, input.parentRunId ?? '', loadContextRunId, 'load_view_context', { contextScope: input.contextScope, documentType: input.documentType, documentId: input.documentId }, 'chain');
    let context: Awaited<ReturnType<typeof loadWorkspaceContext>> | Awaited<ReturnType<typeof loadViewContext>>;
    try {
      context = input.contextScope === 'workspace'
        ? await loadWorkspaceContext(input.workspaceId)
        : await loadViewContext(String(input.documentType ?? ''), String(input.documentId ?? ''));
      await finishLangSmithChildRun(input.config, loadContextRunId, { degraded: !!(context as { degraded?: unknown }).degraded }, 'completed');
    } catch (err) {
      await finishLangSmithChildRun(input.config, loadContextRunId, {}, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }

    const reasoning = await reasonOnContext(context, input.prompt, input.config, input.contextScope, input.history ?? []);
    // When no tool was identified (we're in the LLM reasoning path), there is nothing
    // concrete to confirm — suppress the mutation-confirm flag so the LLM can respond
    // directly instead of showing a useless "Action proposed" confirm dialog.
    // (Bug #17 root cause: client sends requiresMutationConfirm=true for any "update"
    //  prompt; without this guard, the LLM path echoes it back even when no tool fired.)
    const response = generateResponse(reasoning, {
      requiresMutationConfirm: false,
      explicitConfirm: input.explicitConfirm,
    });

    return {
      mode: 'on_demand',
      kind: 'reasoned',
      contextScope: input.contextScope,
      response: String(response.response ?? ''),
      requiresConfirm: Boolean(response.requiresConfirm),
      degraded: Boolean((context as { degraded?: unknown }).degraded),
      degradedReason: ((context as { degradedReason?: unknown }).degradedReason as string | null | undefined) ?? null,
      reasoning,
      contextLoaded: Boolean((reasoning as { contextLoaded?: unknown }).contextLoaded),
      historyCount: Number((reasoning as { historyCount?: unknown }).historyCount ?? 0),
    };
  }
}

let compiledGraphSingleton: FleetGraphCompiledGraph | null = null;

export function getFleetGraphCompiledGraph(): FleetGraphCompiledGraph {
  if (!compiledGraphSingleton) {
    compiledGraphSingleton = new FleetGraphCompiledGraph();
  }
  return compiledGraphSingleton;
}
