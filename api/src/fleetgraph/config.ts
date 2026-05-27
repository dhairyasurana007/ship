import type { FleetGraphConfig } from './types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
const DEFAULT_LANGSMITH_PROJECT = 'default';
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
  const providerRaw = (env.FLEETGRAPH_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  if (providerRaw !== 'openai' && providerRaw !== 'openrouter') {
    throw new Error(`Invalid FLEETGRAPH_PROVIDER: expected "openai" or "openrouter", received "${providerRaw}"`);
  }
  const provider = providerRaw as FleetGraphConfig['provider'];
  const openAiApiKey = env.OPENAI_API_KEY || null;
  const openRouterApiKey = env.OPENROUTER_API_KEY || null;
  const openRouterBaseUrl = env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;
  const langSmithTracing = (env.LANGSMITH_TRACING ?? env.FLEETGRAPH_LANGSMITH_ENABLED ?? 'false') === 'true';
  const langSmithApiKey = env.LANGSMITH_API_KEY || null;
  const langSmithEndpoint = env.LANGSMITH_ENDPOINT ?? env.FLEETGRAPH_LANGSMITH_ENDPOINT ?? DEFAULT_LANGSMITH_ENDPOINT;
  const langSmithProject = env.LANGSMITH_PROJECT ?? env.FLEETGRAPH_LANGSMITH_PROJECT ?? DEFAULT_LANGSMITH_PROJECT;
  const langSmithWorkspaceId = env.LANGSMITH_WORKSPACE_ID || null;

  if (enabled && provider === 'openrouter' && !openRouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is required when FLEETGRAPH_PROVIDER=openrouter and FLEETGRAPH_ENABLED=true');
  }
  if (enabled && langSmithTracing && !langSmithApiKey) {
    throw new Error('LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true and FLEETGRAPH_ENABLED=true');
  }

  return {
    enabled,
    provider,
    model: env.FLEETGRAPH_MODEL || DEFAULT_MODEL,
    openAiApiKey,
    openRouterApiKey,
    openRouterBaseUrl,
    langSmithTracing,
    langSmithApiKey,
    langSmithEndpoint,
    langSmithProject,
    langSmithWorkspaceId,
    maxConcurrency: parsePositiveInt(env.FLEETGRAPH_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY, 'FLEETGRAPH_MAX_CONCURRENCY'),
    queueSize: parsePositiveInt(env.FLEETGRAPH_QUEUE_SIZE, DEFAULT_QUEUE_SIZE, 'FLEETGRAPH_QUEUE_SIZE'),
    pollIntervalMs: parsePositiveInt(env.FLEETGRAPH_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 'FLEETGRAPH_POLL_INTERVAL_MS'),
  };
}
