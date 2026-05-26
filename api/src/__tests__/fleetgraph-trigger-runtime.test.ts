import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn(async () => ({
      query: vi.fn(),
      on: vi.fn(),
      release: vi.fn(),
    })),
  },
}));

vi.mock('../fleetgraph/run-store.js', () => ({
  insertFleetGraphRun: mockInsert,
  updateFleetGraphRunStatus: mockUpdate,
}));

import { FleetGraphTriggerRuntime } from '../fleetgraph/trigger-runtime.js';

describe('fleetgraph trigger runtime', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockInsert.mockReset();
    mockUpdate.mockReset();
  });

  it('enqueues run from LISTEN payload', async () => {
    const runtime = new FleetGraphTriggerRuntime({
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      openRouterApiKey: null,
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      langSmithTracing: false,
      langSmithApiKey: null,
      langSmithEndpoint: 'https://api.smith.langchain.com',
      langSmithProject: 'default',
      langSmithWorkspaceId: null,
      maxConcurrency: 1,
      queueSize: 10,
      pollIntervalMs: 120000,
    });

    await runtime.handleListenPayload(
      JSON.stringify({
        workspaceId: 'w1',
        entityId: 'd1',
        entityType: 'issue',
      })
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0]?.[0]?.triggerType).toBe('pg_event');
  });

  it('poll fallback enqueues runs after watermark advances', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'doc-1',
          workspace_id: 'w1',
          document_type: 'issue',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const runtime = new FleetGraphTriggerRuntime({
      enabled: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      openRouterApiKey: null,
      openRouterBaseUrl: 'https://openrouter.ai/api/v1',
      langSmithTracing: false,
      langSmithApiKey: null,
      langSmithEndpoint: 'https://api.smith.langchain.com',
      langSmithProject: 'default',
      langSmithWorkspaceId: null,
      maxConcurrency: 1,
      queueSize: 10,
      pollIntervalMs: 120000,
    });

    await runtime.runPollOnce();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0]?.[0]?.triggerType).toBe('poll_fallback');
  });
});
