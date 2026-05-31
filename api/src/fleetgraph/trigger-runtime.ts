import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { logFleetGraphError, logFleetGraphInfo } from './logger.js';
import { insertFleetGraphRun, updateFleetGraphRunStatus } from './run-store.js';
import { FleetGraphTriggerQueue } from './trigger-queue.js';
import { buildDedupStateValue, evaluateDedup, type DedupStateValue } from './dedup-worsening.js';
import { createLangSmithRun, finishLangSmithRun } from './langsmith.js';
import { persistFleetGraphOutputs } from './output-store.js';
import { getTraceContext } from './observability.js';
import { getFleetGraphState, upsertFleetGraphState } from './state-store.js';
import { getFleetGraphCompiledGraph } from './compiled-graph.js';
import type { FleetGraphConfig, FleetGraphRunEnvelope, TriggerEvent, TriggerType } from './types.js';
import { registerSessionCallbacks } from './session-tracker.js';

const LISTEN_CHANNEL = 'document_changes';

const PG_EVENT_DEBOUNCE_MS = 5000;

export class FleetGraphTriggerRuntime {
  private listenClient: PoolClient | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly pgEventDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly queue: FleetGraphTriggerQueue;

  constructor(private readonly config: FleetGraphConfig) {
    const graph = getFleetGraphCompiledGraph();
    this.queue = new FleetGraphTriggerQueue(config.maxConcurrency, config.queueSize, async (envelope) => {
      await updateFleetGraphRunStatus(envelope.runId, 'running');
      await createLangSmithRun(this.config, envelope);
      try {
        if (envelope.workspaceId) {
          const graphResult = await graph.invoke({
            mode: 'proactive',
            workspaceId: envelope.workspaceId,
            parentRunId: envelope.runId,
            config: this.config,
          });
          const conditions = graphResult.conditions;
          envelope.payload.conditions = conditions;
          envelope.payload.outputs = graphResult.outputs;
          envelope.payload.proactiveContext = graphResult.context;
          await persistFleetGraphOutputs(envelope.runId, envelope.workspaceId, conditions, graphResult.outputs);
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
    registerSessionCallbacks(
      () => this.startPollFallback(),
      () => this.stopPollFallback()
    );
    logFleetGraphInfo('Poll fallback is session-gated (starts on first login, stops on last logout).');
  }

  private stopPollFallback(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logFleetGraphInfo('Poll fallback deactivated (no active sessions).');
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of this.pgEventDebounceTimers.values()) clearTimeout(timer);
    this.pgEventDebounceTimers.clear();

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
    // Heartbeat behavior: enqueue at least one proactive run per workspace
    // on every poll interval, regardless of document updates.
    const workspaces = await pool.query(
      `SELECT id
       FROM workspaces
       WHERE archived_at IS NULL
       ORDER BY created_at ASC`
    );

    const pollTimestamp = new Date().toISOString();
    for (const row of workspaces.rows) {
      const workspaceId = String(row.id);
      await this.enqueueTrigger('poll_fallback', {
        workspaceId,
        entityId: workspaceId,
        entityType: 'workspace',
        updatedAt: pollTimestamp,
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
    const workspaceId = parsed.workspaceId ?? 'unknown';
    const existing = this.pgEventDebounceTimers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pgEventDebounceTimers.delete(workspaceId);
      void this.enqueueTrigger('pg_event', parsed);
    }, PG_EVENT_DEBOUNCE_MS);
    this.pgEventDebounceTimers.set(workspaceId, timer);
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
