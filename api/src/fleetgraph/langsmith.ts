import type { FleetGraphConfig, FleetGraphRunEnvelope } from './types.js';
import { logFleetGraphError, logFleetGraphInfo } from './logger.js';
const LANGSMITH_HTTP_TIMEOUT_MS = 8000;

function headers(config: FleetGraphConfig): Record<string, string> {
  const out: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.langSmithApiKey || '',
    Authorization: `Bearer ${config.langSmithApiKey || ''}`,
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, '/runs'), {
      method: 'POST',
      headers: headers(config),
      signal: controller.signal,
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
        ...(config.langSmithProjectId ? { session_id: config.langSmithProjectId } : {}),
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      logFleetGraphError('LangSmith create run failed.', {
        status: res.status,
        runId: envelope.runId,
        body,
      });
      return;
    }
    logFleetGraphInfo('LangSmith run created.', { runId: envelope.runId });
  } catch (error) {
    logFleetGraphError('LangSmith create run request error.', {
      runId: envelope.runId,
      error,
    });
  }
}

export async function finishLangSmithRun(
  config: FleetGraphConfig,
  envelope: FleetGraphRunEnvelope,
  status: 'completed' | 'failed' | 'skipped',
  errorMessage?: string
): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, `/runs/${encodeURIComponent(envelope.runId)}`), {
      method: 'PATCH',
      headers: headers(config),
      signal: controller.signal,
      body: JSON.stringify({
        end_time: new Date().toISOString(),
        outputs: {
          status,
          payload: envelope.payload,
        },
        error: status === 'failed' ? errorMessage ?? 'fleetgraph_run_failed' : null,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      logFleetGraphError('LangSmith finish run failed.', {
        status: res.status,
        runId: envelope.runId,
        body,
      });
      return;
    }
    logFleetGraphInfo('LangSmith run finalized.', { runId: envelope.runId, status });
  } catch (error) {
    logFleetGraphError('LangSmith finish run request error.', {
      runId: envelope.runId,
      status,
      error,
    });
  }
}
