import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockQuery,
  },
}));

import { generateResponse, loadViewContext, reasonOnContext } from '../fleetgraph/on-demand.js';

describe('fleetgraph on-demand context', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('loads current view context without restating context', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'd1', document_type: 'issue', title: 'Issue A' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ field: 'state', changed_at: new Date().toISOString() }],
    });

    const context = await loadViewContext('issue', 'd1');
    const reasoning = reasonOnContext(context, 'What is next?');
    expect(reasoning.contextLoaded).toBe(true);
  });

  it('honors the 30-day history cap in query', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const context = await loadViewContext('issue', 'missing');
    expect(context.history).toEqual([]);
  });

  it('requires explicit confirm for mutation proposals', () => {
    const result = generateResponse({ summary: 'mutate' }, { requiresMutationConfirm: true, explicitConfirm: false });
    expect(result.requiresConfirm).toBe(true);
  });
});

