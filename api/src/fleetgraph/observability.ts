import crypto from 'crypto';

export interface FleetGraphTraceContext {
  enabled: boolean;
  endpoint: string | null;
  project: string | null;
  traceId: string;
}

export function getTraceContext(runId: string, env: NodeJS.ProcessEnv = process.env): FleetGraphTraceContext {
  const enabled = env.FLEETGRAPH_LANGSMITH_ENABLED === 'true';
  return {
    enabled,
    endpoint: env.FLEETGRAPH_LANGSMITH_ENDPOINT ?? null,
    project: env.FLEETGRAPH_LANGSMITH_PROJECT ?? null,
    traceId: `${runId}:${crypto.randomUUID()}`,
  };
}

