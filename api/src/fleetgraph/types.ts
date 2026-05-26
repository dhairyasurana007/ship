export type TriggerType = 'schedule' | 'pg_event' | 'user_request';

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
  payload: unknown;
  createdAt: string;
}
