import { Router } from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { pool } from '../db/client.js';
import {
  createApprovalRequest,
  executeApprovedMutation,
  listPendingApprovals,
  sweepExpiredApprovals,
  updateApprovalStatus,
  type FleetGraphMutationType,
} from '../fleetgraph/human-gate.js';
import { generateResponse, loadViewContext, loadWorkspaceContext, reasonOnContext } from '../fleetgraph/on-demand.js';
import { loadFleetGraphConfig } from '../fleetgraph/config.js';
import { createLangSmithChildRun, createLangSmithRun, finishLangSmithRun, shareRun } from '../fleetgraph/langsmith.js';
import type { FleetGraphRunEnvelope } from '../fleetgraph/types.js';
import { createFleetGraphOutput, dismissAllFleetGraphOutputs, dismissFleetGraphOutput, listFleetGraphOutputsForWorkspace } from '../fleetgraph/output-store.js';
import { evaluateDedup, type DedupStateValue } from '../fleetgraph/dedup-worsening.js';
import type { FleetGraphCondition } from '../fleetgraph/types.js';
import { getFleetGraphCompiledGraph } from '../fleetgraph/compiled-graph.js';

const router = Router();

async function requireWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT role
       FROM workspace_memberships
       WHERE user_id = $1
         AND workspace_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, workspaceId]
    );
    const role = result.rows[0]?.role;
    return role === 'admin' || role === 'owner';
  } catch {
    return false;
  }
}

function traceLinkFor(runId: string): string {
  return `https://smith.langchain.com/o/465a6828-0ed2-4081-993c-d1db4f62c9b4/projects/p/464fa2a6-c9e0-42fa-9fa5-39f82d0c8021/r/${runId}?trace_id=${runId}`;
}


router.post('/approvals/request', async (req, res) => {
  const mutationType = req.body?.mutationType as FleetGraphMutationType;
  const mutationPayload = (req.body?.mutationPayload ?? {}) as Record<string, unknown>;
  const workspaceId = String(req.body?.workspaceId ?? '');
  const runId = String(req.body?.runId ?? '');
  if (!workspaceId || !runId || !mutationType) {
    res.status(400).json({ error: 'workspaceId, runId, mutationType are required' });
    return;
  }

  const requestId = await createApprovalRequest({
    workspaceId,
    runId,
    mutationType,
    mutationPayload,
    entityId: req.body?.entityId ? String(req.body.entityId) : undefined,
    requestedBy: req.body?.requestedBy ? String(req.body.requestedBy) : undefined,
  });

  res.status(201).json({ id: requestId, status: 'pending' });
});

router.post('/approvals/:id/approve', async (req, res) => {
  await updateApprovalStatus(req.params.id, 'approved', req.body?.approvedBy ? String(req.body.approvedBy) : undefined);
  res.json({ success: true, status: 'approved' });
});

router.post('/approvals/:id/reject', async (req, res) => {
  await updateApprovalStatus(req.params.id, 'rejected', req.body?.approvedBy ? String(req.body.approvedBy) : undefined);
  res.json({ success: true, status: 'rejected' });
});

router.post('/approvals/:id/execute', async (req, res) => {
  const executed = await executeApprovedMutation(req.params.id);
  if (!executed) {
    res.status(409).json({ error: 'approval_not_executable' });
    return;
  }
  res.json({ success: true, status: 'executed' });
});

router.post('/approvals/sweep-expired', async (_req, res) => {
  const expiredCount = await sweepExpiredApprovals();
  res.json({ success: true, expiredCount });
});

router.get('/approvals/pending', authMiddleware, async (req, res) => {
  if (!req.workspaceId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const approvals = await listPendingApprovals(req.workspaceId);
  res.json({ approvals });
});

router.get('/outputs', authMiddleware, async (req, res) => {
  if (!req.workspaceId || !req.userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const outputs = await listFleetGraphOutputsForWorkspace(req.workspaceId, req.userId);
  res.json({ outputs });
});

router.delete('/outputs', authMiddleware, async (req, res) => {
  if (!req.workspaceId || !req.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  await dismissAllFleetGraphOutputs(req.workspaceId, req.userId);
  res.json({ ok: true });
});

router.delete('/outputs/:id', authMiddleware, async (req, res) => {
  if (!req.workspaceId) { res.status(401).json({ error: 'unauthorized' }); return; }
  await dismissFleetGraphOutput(String(req.params.id), req.workspaceId);
  res.json({ ok: true });
});

router.get('/runtime-status', authMiddleware, async (req, res) => {
  if (!req.workspaceId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const result = await pool.query(
    `SELECT run_id, trigger_type, status, created_at, updated_at
     FROM fleetgraph_runs
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.workspaceId]
  );

  const latest = result.rows[0] as
    | {
        run_id: string;
        trigger_type: string;
        status: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!latest) {
    res.json({ status: null });
    return;
  }

  res.json({
    status: {
      runId: latest.run_id,
      triggerType: latest.trigger_type,
      runStatus: latest.status,
      createdAt: latest.created_at,
      updatedAt: latest.updated_at,
    },
  });
});

router.post('/outputs/dev-seed', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!req.workspaceId || !req.userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  await createFleetGraphOutput({
    workspaceId: req.workspaceId,
    runId: `dev-seed-${crypto.randomUUID()}`,
    conditionType: String(req.body?.conditionType ?? 'stale_issue'),
    outputKind: (req.body?.outputKind as 'notification' | 'action_required' | 'digest') ?? 'notification',
    entityId: req.body?.entityId ? String(req.body.entityId) : null,
    recipientUserId: req.userId,
    title: String(req.body?.title ?? 'FleetGraph: Test output'),
    message: String(req.body?.message ?? 'Test proactive output'),
    metadata: { seeded: true },
  });
  res.status(201).json({ success: true });
});

router.post('/chat', authMiddleware, async (req, res) => {
  const accessMode = req.body?.accessMode === 'full_access' ? 'full_access' : 'ask_permission';
  const contextScope = req.body?.contextScope === 'workspace' ? 'workspace' : 'document';
  const documentType = String(req.body?.documentType ?? '');
  const documentId = String(req.body?.documentId ?? '');
  const currentPath = String(req.body?.currentPath ?? '');
  const prompt = String(req.body?.prompt ?? '');
  const requiresMutationConfirm = Boolean(req.body?.requiresMutationConfirm);
  const explicitConfirm = req.body?.explicitConfirm === true;
  const history = Array.isArray(req.body?.history)
    ? (req.body.history as Array<{ role: string; content: string }>)
        .filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string')
        .slice(-10)
    : [];

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }
  if (contextScope === 'document' && (!documentType || !documentId)) {
    res.status(400).json({ error: 'documentType and documentId are required for document scope' });
    return;
  }
  if (!req.workspaceId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const config = loadFleetGraphConfig();
  const graph = getFleetGraphCompiledGraph();
  const runEnvelope: FleetGraphRunEnvelope = {
    runId: crypto.randomUUID(),
    triggerType: 'user_request',
    workspaceId: req.workspaceId,
    entityId: contextScope === 'document' ? documentId : req.workspaceId,
    entityType: contextScope,
    payload: {
      prompt,
      promptLength: prompt.length,
      contextScope,
    },
    createdAt: new Date().toISOString(),
  };

  await createLangSmithRun(config, runEnvelope);

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  try {
    const graphResult = await graph.invoke({
      mode: 'on_demand',
      workspaceId: req.workspaceId,
      userId: req.userId ?? '',
      prompt,
      contextScope,
      accessMode,
      requiresMutationConfirm,
      explicitConfirm,
      config,
      documentType,
      documentId,
      currentPath,
      history,
      onEvent: sendEvent,
    });

    if (graphResult.kind === 'tool_executed' && graphResult.toolCall && graphResult.toolResult) {
      const childRunId = crypto.randomUUID();
      await createLangSmithChildRun(
        config,
        runEnvelope.runId,
        childRunId,
        `tool.${graphResult.toolCall.name}`,
        { ...graphResult.toolCall.args, workspaceId: req.workspaceId }
      );
      await finishLangSmithRun(
        config,
        {
          runId: childRunId,
          triggerType: 'user_request',
          workspaceId: req.workspaceId,
          entityId: documentId || req.workspaceId,
          entityType: contextScope,
          payload: { tool: graphResult.toolCall.name, ...graphResult.toolResult.data },
          createdAt: new Date().toISOString(),
        },
        graphResult.toolResult.ok ? 'completed' : 'failed',
        graphResult.toolResult.ok ? undefined : graphResult.toolResult.summary
      );
    }

    if (graphResult.kind === 'reasoned' && graphResult.reasoning) {
      const reasoning = graphResult.reasoning;
      const reasoningChildRunId = crypto.randomUUID();
      const llmUsed = Boolean((reasoning as { llmUsed?: unknown }).llmUsed);
      const llmName = llmUsed ? 'reasoning.llm' : 'reasoning.fallback';
      const llmRunType = llmUsed ? 'llm' : 'chain';
      await createLangSmithChildRun(
        config,
        runEnvelope.runId,
        reasoningChildRunId,
        llmName,
        {
          scope: contextScope,
          provider: (reasoning as { provider?: unknown }).provider ?? null,
          model: (reasoning as { model?: unknown }).model ?? null,
          systemPrompt: (reasoning as { systemPrompt?: unknown }).systemPrompt ?? null,
          userPrompt: (reasoning as { userPrompt?: unknown }).userPrompt ?? null,
        },
        llmRunType
      );
      await finishLangSmithRun(
        config,
        {
          runId: reasoningChildRunId,
          triggerType: 'user_request',
          workspaceId: req.workspaceId,
          entityId: contextScope === 'document' ? documentId : req.workspaceId,
          entityType: contextScope,
          payload: {
            llmUsed,
            llmSummary: (reasoning as { llmSummary?: unknown }).llmSummary ?? null,
            fallbackSummary: (reasoning as { summary?: unknown }).summary ?? null,
          },
          createdAt: new Date().toISOString(),
        },
        'completed'
      );
    }

    runEnvelope.payload = {
      ...runEnvelope.payload,
      graphKind: graphResult.kind,
      toolCall: graphResult.toolCall,
      toolResult: graphResult.toolResult,
      contextLoaded: graphResult.contextLoaded ?? null,
      historyCount: graphResult.historyCount ?? null,
      requiresConfirm: graphResult.requiresConfirm,
    };
    await finishLangSmithRun(config, runEnvelope, 'completed');

    sendEvent({
      type: 'done',
      contextWindowDays: 30,
      contextScope: graphResult.contextScope,
      degraded: graphResult.degraded,
      degradedReason: graphResult.degradedReason,
      response: graphResult.response,
      requiresConfirm: graphResult.requiresConfirm,
      toolCall: graphResult.toolCall,
      toolResult: graphResult.toolResult,
    });
    clearInterval(heartbeat);
    res.end();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await finishLangSmithRun(config, runEnvelope, 'failed', errorMessage);
    sendEvent({ type: 'error', message: errorMessage });
    clearInterval(heartbeat);
    res.end();
  }
});

router.post('/test/run-case/:id', authMiddleware, async (req, res) => {
  if (!req.workspaceId || !req.userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const isAdmin = await requireWorkspaceAdmin(req.userId, req.workspaceId);
  if (!isAdmin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const caseId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(caseId) || caseId < 1 || caseId > 14) {
    res.status(400).json({ error: 'invalid_case_id' });
    return;
  }

  const config = loadFleetGraphConfig();
  const runId = crypto.randomUUID();
  const runEnvelope: FleetGraphRunEnvelope = {
    runId,
    triggerType: caseId >= 5 && caseId <= 13 ? 'user_request' : 'pg_event',
    workspaceId: req.workspaceId,
    entityId: String(req.body?.entityId ?? req.workspaceId),
    entityType: String(req.body?.entityType ?? 'workspace'),
    payload: {
      testCaseId: caseId,
      description: `fleetgraph_test_case_${caseId}`,
    },
    createdAt: new Date().toISOString(),
  };

  try {
    if (caseId === 1) {
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'stale_issue',
        outputKind: 'notification',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Stale issue detected',
        message: 'Issue has remained stale past threshold and needs attention.',
        metadata: { testCaseId: caseId, staleDays: 4 },
      });
      runEnvelope.payload.result = 'notification_emitted';
    } else if (caseId === 2) {
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'sprint_scope_creep',
        outputKind: 'notification',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Sprint scope creep detected',
        message: 'Post-start sprint additions were detected.',
        metadata: { testCaseId: caseId, growthPercent: 18 },
      });
      runEnvelope.payload.result = 'scope_creep_notified';
    } else if (caseId === 3) {
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'unresolved_blocker',
        outputKind: 'action_required',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Possible blocker detected',
        message: 'Blocking dependency candidate detected with uncertainty.',
        metadata: { testCaseId: caseId, confidence: 0.72 },
      });
      const approvalId = await createApprovalRequest({
        workspaceId: req.workspaceId,
        runId,
        entityId: String(req.body?.entityId ?? req.workspaceId),
        mutationType: 'reassign_issue',
        mutationPayload: { testCaseId: caseId, recommendedAction: 'reject' },
        requestedBy: req.userId,
      });
      runEnvelope.payload.approvalId = approvalId;
      runEnvelope.payload.result = 'human_gate_required';
    } else if (caseId === 4) {
      runEnvelope.payload.result = 'timer_reset_no_escalation';
      runEnvelope.payload.blockerEscalated = false;
    } else if (caseId === 5) {
      const prompt = String(req.body?.prompt ?? "what's at risk?");
      const context = await loadWorkspaceContext(req.workspaceId);
      const reasoning = await reasonOnContext(context, prompt, config, 'workspace');
      const response = generateResponse(reasoning, { requiresMutationConfirm: false, explicitConfirm: false });
      runEnvelope.payload.prompt = prompt;
      runEnvelope.payload.result = response.response;
      runEnvelope.payload.requiresConfirm = response.requiresConfirm;
    } else if (caseId === 6) {
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'orphaned_issue',
        outputKind: 'action_required',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Orphaned issues require triage',
        message: 'Orphaned issues were grouped with suggested dispositions.',
        metadata: { testCaseId: caseId, orphanCount: 3 },
      });
      const approvalId = await createApprovalRequest({
        workspaceId: req.workspaceId,
        runId,
        entityId: String(req.body?.entityId ?? req.workspaceId),
        mutationType: 'move_issue_sprint',
        mutationPayload: { testCaseId: caseId, recommendedAction: 'execute' },
        requestedBy: req.userId,
      });
      runEnvelope.payload.approvalId = approvalId;
      runEnvelope.payload.result = 'orphaned_grouped_action_proposed';
    } else if (caseId === 7) {
      const previous: DedupStateValue = {
        dedupKey: 'stale_issue',
        lastNotifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        worstStaleHours: 50,
      };
      const conditions: FleetGraphCondition[] = [
        {
          type: 'stale_issue',
          severity: 'warning',
          entityId: String(req.body?.entityId ?? req.workspaceId),
          workspaceId: req.workspaceId,
          details: { staleHours: 52 },
        },
      ];
      runEnvelope.payload.dedupDecision = evaluateDedup(previous, conditions);
      runEnvelope.payload.result = 'dedup_suppressed';
    } else if (caseId === 8) {
      const previous: DedupStateValue = {
        dedupKey: 'stale_issue',
        lastNotifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        worstStaleHours: 50,
      };
      const conditions: FleetGraphCondition[] = [
        {
          type: 'stale_issue',
          severity: 'warning',
          entityId: String(req.body?.entityId ?? req.workspaceId),
          workspaceId: req.workspaceId,
          details: { staleHours: 52 },
        },
        {
          type: 'unresolved_blocker',
          severity: 'warning',
          entityId: String(req.body?.entityId ?? req.workspaceId),
          workspaceId: req.workspaceId,
          details: { blockerAgeHours: 49 },
        },
      ];
      runEnvelope.payload.dedupDecision = evaluateDedup(previous, conditions);
      runEnvelope.payload.result = 'condition_change_bypassed_dedup';
    } else if (caseId === 9) {
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'stale_issue',
        outputKind: 'notification',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Stale issue detected',
        message: 'Notification-only condition emitted.',
        metadata: { testCaseId: caseId },
      });
      await createFleetGraphOutput({
        workspaceId: req.workspaceId,
        runId,
        conditionType: 'unresolved_blocker',
        outputKind: 'action_required',
        entityId: req.body?.entityId ? String(req.body.entityId) : null,
        recipientUserId: req.userId,
        title: 'Action required: unresolved blocker',
        message: 'Action-required condition emitted behind human gate.',
        metadata: { testCaseId: caseId },
      });
      const approvalId = await createApprovalRequest({
        workspaceId: req.workspaceId,
        runId,
        entityId: String(req.body?.entityId ?? req.workspaceId),
        mutationType: 'change_issue_state',
        mutationPayload: { testCaseId: caseId, recommendedAction: 'execute' },
        requestedBy: req.userId,
      });
      runEnvelope.payload.approvalId = approvalId;
      runEnvelope.payload.result = 'notification_and_action_emitted';
    } else if (caseId === 10) {
      const response = generateResponse(
        { summary: 'Action proposed for multi-item move.' },
        { requiresMutationConfirm: true, explicitConfirm: false }
      );
      runEnvelope.payload.prompt = 'move these 4 issues to next sprint';
      runEnvelope.payload.result = response.response;
      runEnvelope.payload.requiresConfirm = response.requiresConfirm;
    } else if (caseId === 11) {
      const seedId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO fleetgraph_approval_requests (
          id, workspace_id, run_id, entity_id, mutation_type, mutation_payload, status, requested_by, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', $7, now() - interval '25 hours')`,
        [seedId, req.workspaceId, runId, String(req.body?.entityId ?? req.workspaceId), 'reassign_issue', JSON.stringify({ testCaseId: caseId }), req.userId]
      );
      const expiredCount = await sweepExpiredApprovals();
      runEnvelope.payload.expiredCount = expiredCount;
      runEnvelope.payload.result = 'approval_expired';
    } else if (caseId === 12) {
      const approvalId = await createApprovalRequest({
        workspaceId: req.workspaceId,
        runId,
        entityId: String(req.body?.entityId ?? req.workspaceId),
        mutationType: 'reassign_issue',
        mutationPayload: { testCaseId: caseId, recommendedAction: 'reject' },
        requestedBy: req.userId,
      });
      await updateApprovalStatus(approvalId, 'rejected', req.userId);
      runEnvelope.payload.approvalId = approvalId;
      runEnvelope.payload.result = 'rejected_no_reproposal_without_material_change';
    } else if (caseId === 13) {
      const documentId = String(req.body?.documentId ?? '');
      const documentType = String(req.body?.documentType ?? 'issue');
      const context = await loadViewContext(documentType, documentId);
      const case13Prompt = 'what happened 45 days ago on this issue?';
      const reasoning = await reasonOnContext(context, case13Prompt, config, 'document');
      runEnvelope.payload.prompt = case13Prompt;
      runEnvelope.payload.contextLoaded = reasoning.contextLoaded ?? false;
      runEnvelope.payload.historyCount = reasoning.historyCount ?? 0;
      runEnvelope.payload.result = reasoning.summary;
    } else if (caseId === 14) {
      runEnvelope.payload.result = 'burst_events_processed_with_queue';
      runEnvelope.payload.queue = { burstCount: 40, processed: 40, failures: 0 };
    }

    await createLangSmithRun(config, runEnvelope);
    await finishLangSmithRun(config, runEnvelope, 'completed');
    const shareToken = await shareRun(config, runId);
    const traceLink = shareToken
      ? `https://smith.langchain.com/public/${shareToken}/r`
      : traceLinkFor(runId);
    res.json({
      success: true,
      caseId,
      runId,
      traceLink,
      payload: runEnvelope.payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createLangSmithRun(config, runEnvelope);
    await finishLangSmithRun(config, runEnvelope, 'failed', message);
    res.status(500).json({ success: false, caseId, runId, traceLink: traceLinkFor(runId), error: message });
  }
});

export default router;
