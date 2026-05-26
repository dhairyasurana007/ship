import type { FleetGraphConfig } from './types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_QUEUE_SIZE = 100;
const DEFAULT_POLL_INTERVAL_MS = 120000;

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected positive integer, received "${value}"`);
  }
  return parsed;
}

export function loadFleetGraphConfig(env: NodeJS.ProcessEnv = process.env): FleetGraphConfig {
  const enabled = env.FLEETGRAPH_ENABLED === 'true';
  return {
    enabled,
    model: env.FLEETGRAPH_MODEL || DEFAULT_MODEL,
    maxConcurrency: parsePositiveInt(env.FLEETGRAPH_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY, 'FLEETGRAPH_MAX_CONCURRENCY'),
    queueSize: parsePositiveInt(env.FLEETGRAPH_QUEUE_SIZE, DEFAULT_QUEUE_SIZE, 'FLEETGRAPH_QUEUE_SIZE'),
    pollIntervalMs: parsePositiveInt(env.FLEETGRAPH_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 'FLEETGRAPH_POLL_INTERVAL_MS'),
  };
}
