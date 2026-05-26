import { Router } from 'express';
import {
  createApprovalRequest,
  executeApprovedMutation,
  sweepExpiredApprovals,
  updateApprovalStatus,
  type FleetGraphMutationType,
} from '../fleetgraph/human-gate.js';

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

export default router;

