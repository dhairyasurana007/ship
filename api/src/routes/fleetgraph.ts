import { Router } from 'express';
import crypto from 'crypto';
import {
  createApprovalRequest,
  executeApprovedMutation,
  sweepExpiredApprovals,
  updateApprovalStatus,
  type FleetGraphMutationType,
} from '../fleetgraph/human-gate.js';
import { generateResponse, loadViewContext, reasonOnContext } from '../fleetgraph/on-demand.js';
import { loadFleetGraphConfig } from '../fleetgraph/config.js';
import { createLangSmithRun, finishLangSmithRun } from '../fleetgraph/langsmith.js';
import type { FleetGraphRunEnvelope } from '../fleetgraph/types.js';

const router = Router();

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

router.post('/chat', async (req, res) => {
  const documentType = String(req.body?.documentType ?? '');
  const documentId = String(req.body?.documentId ?? '');
  const prompt = String(req.body?.prompt ?? '');
  const requiresMutationConfirm = Boolean(req.body?.requiresMutationConfirm);
  const explicitConfirm = req.body?.explicitConfirm === true;

  if (!documentType || !documentId || !prompt) {
    res.status(400).json({ error: 'documentType, documentId, prompt are required' });
    return;
  }
  const config = loadFleetGraphConfig();
  const runEnvelope: FleetGraphRunEnvelope = {
    runId: crypto.randomUUID(),
    triggerType: 'user_request',
    workspaceId: req.workspaceId,
    entityId: documentId,
    entityType: documentType,
    payload: { promptLength: prompt.length },
    createdAt: new Date().toISOString(),
  };

  await createLangSmithRun(config, runEnvelope);

  try {
    const context = await loadViewContext(documentType, documentId);
    const reasoning = reasonOnContext(context, prompt);
    const response = generateResponse(reasoning, { requiresMutationConfirm, explicitConfirm });

    runEnvelope.payload = {
      ...runEnvelope.payload,
      contextLoaded: Boolean(context.document),
      historyCount: Array.isArray(context.history) ? context.history.length : 0,
      requiresConfirm: response.requiresConfirm,
    };
    await finishLangSmithRun(config, runEnvelope, 'completed');

    res.json({
      contextWindowDays: 30,
      context,
      reasoning,
      ...response,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await finishLangSmithRun(config, runEnvelope, 'failed', errorMessage);
    throw error;
  }
});

export default router;
