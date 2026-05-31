import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockQuery,
  },
}));

import { buildSystemPrompt, generateResponse, loadViewContext, loadWorkspaceContext, reasonOnContext } from '../fleetgraph/on-demand.js';

describe('fleetgraph on-demand context', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('loads current view context without restating context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ column_name: 'changed_at' }],
    });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'd1', document_type: 'issue', title: 'Issue A' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ field: 'state', changed_at: new Date().toISOString() }],
    });

    const context = await loadViewContext('issue', 'd1');
    const reasoning = await reasonOnContext(context, 'What is next?');
    expect(reasoning.contextLoaded).toBe(true);
  });

  it('honors the 30-day history cap in query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ column_name: 'changed_at' }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const context = await loadViewContext('issue', 'missing');
    expect(context.history).toEqual([]);
  });

  it('requires explicit confirm for mutation proposals', () => {
    const result = generateResponse({ summary: 'mutate' }, { requiresMutationConfirm: true, explicitConfirm: false });
    expect(result.requiresConfirm).toBe(true);
  });
});

describe('loadWorkspaceContext', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('includes currentPath in returned context', async () => {
    mockQuery.mockResolvedValue({ rows: [{ open_issue_count: 0 }], rowCount: 1 });
    const ctx = await loadWorkspaceContext('w1', '/projects/p1');
    expect(ctx.currentPath).toBe('/projects/p1');
    expect(ctx.scope).toBe('workspace');
  });

  it('returns currentPath as null when not provided', async () => {
    mockQuery.mockResolvedValue({ rows: [{ open_issue_count: 0 }], rowCount: 1 });
    const ctx = await loadWorkspaceContext('w1');
    expect(ctx.currentPath).toBeNull();
  });

  it('returns degraded workspace context on query failure', async () => {
    mockQuery.mockRejectedValue(new Error('connection_timeout'));
    const ctx = await loadWorkspaceContext('w1', '/dashboard');
    expect(ctx.degraded).toBe(true);
    expect(ctx.scope).toBe('workspace');
  });
});

describe('buildSystemPrompt', () => {
  it('workspace scope includes cross-project summary instruction', () => {
    const prompt = buildSystemPrompt('workspace');
    expect(prompt).toContain('workspace level');
  });

  it('document scope includes current-document-only instruction', () => {
    const prompt = buildSystemPrompt('document');
    expect(prompt).toContain('document level');
  });
});
