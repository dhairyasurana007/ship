import { describe, expect, it } from 'vitest';
import { loadFleetGraphConfig } from '../fleetgraph/config.js';

describe('fleetgraph config', () => {
  it('loads defaults when optional values are omitted', () => {
    const cfg = loadFleetGraphConfig({ FLEETGRAPH_ENABLED: 'true' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.maxConcurrency).toBe(2);
    expect(cfg.queueSize).toBe(100);
    expect(cfg.pollIntervalMs).toBe(120000);
  });

  it('throws for invalid numeric env values', () => {
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_MAX_CONCURRENCY: '0' })).toThrow(/FLEETGRAPH_MAX_CONCURRENCY/);
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_QUEUE_SIZE: '-1' })).toThrow(/FLEETGRAPH_QUEUE_SIZE/);
    expect(() => loadFleetGraphConfig({ FLEETGRAPH_POLL_INTERVAL_MS: 'abc' })).toThrow(/FLEETGRAPH_POLL_INTERVAL_MS/);
  });
});
