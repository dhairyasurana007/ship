import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLangSmithRun, finishLangSmithRun } from '../fleetgraph/langsmith.js';
import type { FleetGraphConfig, FleetGraphRunEnvelope } from '../fleetgraph/types.js';

describe('fleetgraph langsmith client', () => {
  const fetchMock = vi.fn();

  const config: FleetGraphConfig = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
    openRouterApiKey: null,
    openRouterBaseUrl: 'https://openrouter.ai/api/v1',
    langSmithTracing: true,
    langSmithApiKey: 'ls-key',
    langSmithEndpoint: 'https://api.smith.langchain.com',
    langSmithProject: 'ship-fleetgraph-mvp',
    langSmithWorkspaceId: null,
    maxConcurrency: 2,
    queueSize: 100,
    pollIntervalMs: 120000,
  };

  const envelope: FleetGraphRunEnvelope = {
    runId: '11111111-1111-4111-8111-111111111111',
    triggerType: 'pg_event',
    workspaceId: 'w1',
    entityId: 'e1',
    entityType: 'issue',
    payload: {},
    createdAt: '2026-05-26T00:00:00.000Z',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('posts run start', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await createLangSmithRun(config, envelope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/runs');
  });

  it('patches run completion', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await finishLangSmithRun(config, envelope, 'completed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/runs/${encodeURIComponent(envelope.runId)}`);
  });
});

