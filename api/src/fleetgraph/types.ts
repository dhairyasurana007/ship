export type TriggerType = 'schedule' | 'pg_event' | 'poll_fallback' | 'user_request';
export type FleetGraphRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface FleetGraphConfig {
  enabled: boolean;
  model: string;
  maxConcurrency: number;
  queueSize: number;
  pollIntervalMs: number;
}

export interface FleetGraphRunEnvelope {
  runId: string;
  triggerType: TriggerType;
  workspaceId?: string;
  entityId?: string;
  entityType?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TriggerEvent {
  workspaceId: string;
  entityId: string;
  entityType: string;
  updatedAt?: string;
}
