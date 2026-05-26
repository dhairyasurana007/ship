import { describe, expect, it } from 'vitest';
import { getTraceContext } from '../fleetgraph/observability.js';

describe('fleetgraph observability', () => {
  it('honors tracing env config', () => {
    const ctx = getTraceContext('run-1', {
      FLEETGRAPH_LANGSMITH_ENABLED: 'true',
      FLEETGRAPH_LANGSMITH_ENDPOINT: 'https://langsmith.example',
      FLEETGRAPH_LANGSMITH_PROJECT: 'fleetgraph-mvp',
    } as NodeJS.ProcessEnv);

    expect(ctx.enabled).toBe(true);
    expect(ctx.endpoint).toBe('https://langsmith.example');
    expect(ctx.project).toBe('fleetgraph-mvp');
    expect(ctx.traceId.startsWith('run-1:')).toBe(true);
  });
});

