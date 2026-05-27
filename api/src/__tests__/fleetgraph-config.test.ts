import { describe, expect, it } from 'vitest';
import { loadFleetGraphConfig } from '../fleetgraph/config.js';

describe('fleetgraph config', () => {
  it('loads defaults when optional values are omitted', () => {
    const cfg = loadFleetGraphConfig({ FLEETGRAPH_ENABLED: 'true' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.openRouterApiKey).toBeNull();
    expect(cfg.openRouterBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(cfg.langSmithTracing).toBe(false);
    expect(cfg.langSmithApiKey).toBeNull();
    expect(cfg.langSmithEndpoint).toBe('https://api.smith.langchain.com');
    expect(cfg.langSmithProject).toBe('default');
    expect(cfg.langSmithProjectId).toBeNull();
    expect(cfg.langSmithWorkspaceId).toBeNull();
    expect(cfg.maxConcurrency).toBe(2);
    expect(cfg.queueSize).toBe(100);
    expect(cfg.pollIntervalMs).toBe(120000);
  });

  it('throws for invalid numeric env values', () => {
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_MAX_CONCURRENCY: '0' })).toThrow(/FLEETGRAPH_MAX_CONCURRENCY/);
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_QUEUE_SIZE: '-1' })).toThrow(/FLEETGRAPH_QUEUE_SIZE/);
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_POLL_INTERVAL_MS: 'abc' })).toThrow(/FLEETGRAPH_POLL_INTERVAL_MS/);
  });

  it('requires OPENROUTER_API_KEY when openrouter provider is enabled', () => {
    expect(() =>
      loadFleetGraphConfig({
        FLEETGRAPH_ENABLED: 'true',
        FLEETGRAPH_PROVIDER: 'openrouter',
      })
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it('accepts openrouter config when key is provided', () => {
    const cfg = loadFleetGraphConfig({
      FLEETGRAPH_ENABLED: 'true',
      FLEETGRAPH_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    });

    expect(cfg.provider).toBe('openrouter');
    expect(cfg.openRouterApiKey).toBe('test-key');
    expect(cfg.openRouterBaseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('requires LANGSMITH_API_KEY when tracing is enabled', () => {
    expect(() =>
      loadFleetGraphConfig({
        FLEETGRAPH_ENABLED: 'true',
        LANGSMITH_TRACING: 'true',
      })
    ).toThrow(/LANGSMITH_API_KEY/);
  });
});
