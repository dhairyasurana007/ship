import crypto from 'crypto';
import { classifyConditions } from './classify-conditions.js';
import { generateResponse, loadViewContext, loadWorkspaceContext, reasonOnContext } from './on-demand.js';
import { fetchIssues, loadProjectContext } from './proactive-context.js';
import { routeOutputs } from './notifications.js';
import { executeToolCall, inferToolCallFromPrompt, type FleetGraphToolCall, type FleetGraphToolResult } from './tools.js';
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

class FleetGraphCompiledGraph {
  async invoke(input: ProactiveGraphInput): Promise<ProactiveGraphOutput>;
  async invoke(input: OnDemandGraphInput): Promise<OnDemandGraphOutput>;
  async invoke(input: FleetGraphInvokeInput): Promise<FleetGraphInvokeOutput> {
    if (input.mode === 'proactive') {
      const projectContext = await loadProjectContext(input.workspaceId);
      const fetchIssuesRunId = crypto.randomUUID();
      await createLangSmithChildRun(input.config, input.parentRunId ?? '', fetchIssuesRunId, 'fetch_issues', { workspaceId: input.workspaceId }, 'chain');
      let issues: Awaited<ReturnType<typeof fetchIssues>>;
      try {
        issues = await fetchIssues(input.workspaceId);
        await finishLangSmithChildRun(input.config ?? {} as FleetGraphConfig, fetchIssuesRunId, { issueCount: issues.length }, 'completed');
      } catch (err) {
        await finishLangSmithChildRun(input.config ?? {} as FleetGraphConfig, fetchIssuesRunId, {}, 'failed', err instanceof Error ? err.message : String(err));
        throw err;
      }
      const conditions = classifyConditions(issues);
      return {
        mode: 'proactive',
        conditions,
        outputs: routeOutputs(conditions),
        context: {
          project: projectContext,
        },
      };
    }

    const toolCall = inferToolCallFromPrompt({
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
          response: `Action proposed (${toolCall.name}). Explicit confirm is required before mutation.`,
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

      return {
        mode: 'on_demand',
        kind: 'tool_executed',
        contextScope: input.contextScope,
        response: toolResult.summary,
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

    const reasoning = await reasonOnContext(context, input.prompt, input.config, input.contextScope);
    const response = generateResponse(reasoning, {
      requiresMutationConfirm: input.requiresMutationConfirm,
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
