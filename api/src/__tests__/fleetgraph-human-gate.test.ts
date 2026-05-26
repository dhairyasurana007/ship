import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockQuery,
  },
}));

import {
  createApprovalRequest,
  executeApprovedMutation,
  sweepExpiredApprovals,
  updateApprovalStatus,
} from '../fleetgraph/human-gate.js';

describe('fleetgraph human gate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('blocks mutation execution without approval', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await executeApprovedMutation('r1');
    expect(ok).toBe(false);
  });

  it('executes approved mutation', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await executeApprovedMutation('r2');
    expect(ok).toBe(true);
  });

  it('records rejection without executing mutation', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await updateApprovalStatus('r3', 'rejected');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('SET status = $2');
  });

  it('expires pending approvals past TTL', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });
    const count = await sweepExpiredApprovals();
    expect(count).toBe(2);
  });

  it('creates pending approval request', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'abc' }] });
    const id = await createApprovalRequest({
      workspaceId: 'w1',
      runId: 'run-1',
      mutationType: 'change_issue_state',
      mutationPayload: { state: 'done' },
    });
    expect(id).toBe('abc');
  });
});

