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

export async function createLangSmithChildRun(
  config: FleetGraphConfig,
  parentRunId: string,
  childRunId: string,
  name: string,
  inputs: Record<string, unknown>,
  runType: 'tool' | 'llm' | 'chain' = 'tool'
): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, '/runs'), {
      method: 'POST',
      headers: headers(config),
      signal: controller.signal,
      body: JSON.stringify({
        id: childRunId,
        name,
        run_type: runType,
        parent_run_id: parentRunId,
        inputs,
        start_time: new Date().toISOString(),
        session_name: config.langSmithProject,
        ...(config.langSmithProjectId ? { session_id: config.langSmithProjectId } : {}),
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      logFleetGraphError('LangSmith create child run failed.', { status: res.status, childRunId, body });
    }
  } catch (error) {
    logFleetGraphError('LangSmith create child run request error.', { childRunId, error });
  }
}

export async function createLangSmithRun(config: FleetGraphConfig, envelope: FleetGraphRunEnvelope): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;

  try {
    const userPrompt = typeof envelope.payload?.prompt === 'string' ? envelope.payload.prompt : null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, '/runs'), {
      method: 'POST',
      headers: headers(config),
      signal: controller.signal,
      body: JSON.stringify({
        id: envelope.runId,
        name: `fleetgraph_run[${envelope.triggerType}]`,
        run_type: 'chain',
        inputs: {
          triggerType: envelope.triggerType,
          workspaceId: envelope.workspaceId ?? null,
          entityId: envelope.entityId ?? null,
          entityType: envelope.entityType ?? null,
          userPrompt,
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

export async function finishLangSmithChildRun(
  config: FleetGraphConfig,
  childRunId: string,
  outputs: Record<string, unknown>,
  status: 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, `/runs/${encodeURIComponent(childRunId)}`), {
      method: 'PATCH',
      headers: headers(config),
      signal: controller.signal,
      body: JSON.stringify({
        end_time: new Date().toISOString(),
        outputs,
        error: status === 'failed' ? errorMessage ?? 'child_run_failed' : null,
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      logFleetGraphError('LangSmith finish child run failed.', { status: res.status, childRunId, body });
    }
  } catch (error) {
    logFleetGraphError('LangSmith finish child run request error.', { childRunId, error });
  }
}

export async function shareRun(config: FleetGraphConfig, runId: string): Promise<string | null> {
  if (!config.langSmithTracing || !config.langSmithApiKey) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LANGSMITH_HTTP_TIMEOUT_MS);
    const res = await fetch(endpoint(config, `/runs/${encodeURIComponent(runId)}/share`), {
      method: 'PUT',
      headers: headers(config),
      signal: controller.signal,
      body: JSON.stringify({ run_id: runId }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      logFleetGraphError('LangSmith share run failed.', { status: res.status, runId, body });
      return null;
    }
    const data = await res.json() as { share_token?: string };
    return data.share_token ?? null;
  } catch (error) {
    logFleetGraphError('LangSmith share run request error.', { runId, error });
    return null;
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
