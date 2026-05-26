import type { FleetGraphConfig, FleetGraphRunEnvelope } from './types.js';

function headers(config: FleetGraphConfig): Record<string, string> {
  const out: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.langSmithApiKey || '',
  };
  if (config.langSmithWorkspaceId) {
    out['x-tenant-id'] = config.langSmithWorkspaceId;
  }
  return out;
}

function endpoint(config: FleetGraphConfig, path: string): string {
  return `${config.langSmithEndpoint.replace(/\/+$/, '')}${path}`;
}

export async function createLangSmithRun(config: FleetGraphConfig, envelope: FleetGraphRunEnvelope): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;

  await fetch(endpoint(config, '/runs'), {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      id: envelope.runId,
      name: 'fleetgraph_run',
      run_type: 'chain',
      inputs: {
        triggerType: envelope.triggerType,
        workspaceId: envelope.workspaceId ?? null,
        entityId: envelope.entityId ?? null,
        entityType: envelope.entityType ?? null,
      },
      start_time: envelope.createdAt,
      session_name: config.langSmithProject,
    }),
  });
}

export async function finishLangSmithRun(
  config: FleetGraphConfig,
  envelope: FleetGraphRunEnvelope,
  status: 'completed' | 'failed' | 'skipped',
  errorMessage?: string
): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;

  await fetch(endpoint(config, `/runs/${encodeURIComponent(envelope.runId)}`), {
    method: 'PATCH',
    headers: headers(config),
    body: JSON.stringify({
      end_time: new Date().toISOString(),
      outputs: {
        status,
        payload: envelope.payload,
      },
      error: status === 'failed' ? errorMessage ?? 'fleetgraph_run_failed' : null,
    }),
  });
}

