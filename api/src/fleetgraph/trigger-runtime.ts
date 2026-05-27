import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { logFleetGraphError, logFleetGraphInfo } from './logger.js';
import { insertFleetGraphRun, updateFleetGraphRunStatus } from './run-store.js';
import { FleetGraphTriggerQueue } from './trigger-queue.js';
import { classifyConditions } from './classify-conditions.js';
import { buildDedupStateValue, evaluateDedup, type DedupStateValue } from './dedup-worsening.js';
import { createLangSmithRun, finishLangSmithRun } from './langsmith.js';
import { fetchIssues, fetchSprintState, fetchTeamState, loadProjectContext } from './proactive-context.js';
import { routeOutputs } from './notifications.js';
import { persistFleetGraphOutputs } from './output-store.js';
import { getTraceContext } from './observability.js';
import { getFleetGraphState, upsertFleetGraphState } from './state-store.js';
import type { FleetGraphConfig, FleetGraphRunEnvelope, TriggerEvent, TriggerType } from './types.js';

const LISTEN_CHANNEL = 'document_changes';

export class FleetGraphTriggerRuntime {
  private listenClient: PoolClient | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private watermark: Date = new Date(0);
  private readonly queue: FleetGraphTriggerQueue;

  constructor(private readonly config: FleetGraphConfig) {
    this.queue = new FleetGraphTriggerQueue(config.maxConcurrency, config.queueSize, async (envelope) => {
      await updateFleetGraphRunStatus(envelope.runId, 'running');
      await createLangSmithRun(this.config, envelope);
      try {
        if (envelope.workspaceId) {
          await loadProjectContext(envelope.workspaceId);
          const issues = await fetchIssues(envelope.workspaceId);
          await fetchSprintState(envelope.workspaceId);
          await fetchTeamState(envelope.workspaceId);
          const conditions = classifyConditions(issues);
          envelope.payload.conditions = conditions;
          envelope.payload.outputs = routeOutputs(conditions);
          await persistFleetGraphOutputs(envelope.runId, envelope.workspaceId, conditions, envelope.payload.outputs as ReturnType<typeof routeOutputs>);
          const stateEntityId = envelope.entityId ?? 'workspace';
          const previous = await getFleetGraphState(envelope.workspaceId, stateEntityId, 'dedup');
          const dedup = evaluateDedup((previous?.value ?? null) as DedupStateValue | null, conditions);
          envelope.payload.dedup = dedup;

          if (dedup.shouldNotify) {
            const state = buildDedupStateValue(dedup.dedupKey, conditions);
            await upsertFleetGraphState(envelope.workspaceId, stateEntityId, 'dedup', state as unknown as Record<string, unknown>);
          } else {
            await updateFleetGraphRunStatus(envelope.runId, 'skipped');
            await finishLangSmithRun(this.config, envelope, 'skipped');
            return;
          }
        }
        await updateFleetGraphRunStatus(envelope.runId, 'completed');
        await finishLangSmithRun(this.config, envelope, 'completed');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await updateFleetGraphRunStatus(envelope.runId, 'failed', errorMessage);
        await finishLangSmithRun(this.config, envelope, 'failed', errorMessage);
        throw error;
      }
    });
  }

  async start(): Promise<void> {
    await this.startPgListen();
    this.startPollFallback();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.listenClient) {
      try {
        await this.listenClient.query(`UNLISTEN ${LISTEN_CHANNEL}`);
      } finally {
        this.listenClient.release();
        this.listenClient = null;
      }
    }
  }

  async runPollOnce(): Promise<void> {
    const result = await pool.query(
      `SELECT id, workspace_id, document_type, updated_at
       FROM documents
       WHERE updated_at > $1
       ORDER BY updated_at ASC
       LIMIT 100`,
      [this.watermark.toISOString()]
    );

    for (const row of result.rows) {
      const updatedAt = new Date(row.updated_at as string);
      if (updatedAt > this.watermark) {
        this.watermark = updatedAt;
      }

      await this.enqueueTrigger('poll_fallback', {
        workspaceId: String(row.workspace_id),
        entityId: String(row.id),
        entityType: String(row.document_type ?? 'document'),
        updatedAt: updatedAt.toISOString(),
      });
    }
  }

  private async startPgListen(): Promise<void> {
    this.listenClient = await pool.connect();
    await this.listenClient.query(`LISTEN ${LISTEN_CHANNEL}`);
    this.listenClient.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        void this.handleListenPayload(msg.payload);
      } catch (error) {
        logFleetGraphError('Invalid LISTEN payload.', error);
      }
    });
    logFleetGraphInfo('PG LISTEN trigger connected.', { channel: LISTEN_CHANNEL });
  }

  async handleListenPayload(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as TriggerEvent;
    await this.enqueueTrigger('pg_event', parsed);
  }

  private startPollFallback(): void {
    this.pollTimer = setInterval(() => {
      void this.runPollOnce().catch((error) => {
        logFleetGraphError('Poll fallback iteration failed.', error);
      });
    }, this.config.pollIntervalMs);
    logFleetGraphInfo('Poll fallback started.', { pollIntervalMs: this.config.pollIntervalMs });
  }

  private async enqueueTrigger(triggerType: TriggerType, event: TriggerEvent): Promise<void> {
    const envelope: FleetGraphRunEnvelope = {
      runId: crypto.randomUUID(),
      triggerType,
      workspaceId: event.workspaceId,
      entityId: event.entityId,
      entityType: event.entityType,
      payload: {
        updatedAt: event.updatedAt ?? new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };
    envelope.payload.trace = getTraceContext(envelope.runId);

    await insertFleetGraphRun(envelope, 'queued');
    const enqueued = this.queue.enqueue(envelope);
    if (!enqueued) {
      await updateFleetGraphRunStatus(envelope.runId, 'skipped', 'queue_full');
      logFleetGraphInfo('Queue full; run skipped.', { runId: envelope.runId });
    }
  }
}
