export type TriggerType = 'schedule' | 'pg_event' | 'poll_fallback' | 'user_request';
export type FleetGraphRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface FleetGraphConfig {
  enabled: boolean;
  provider: 'openai' | 'openrouter';
  model: string;
  openAiApiKey?: string | null;
  openRouterApiKey: string | null;
  openRouterBaseUrl: string;
  langSmithTracing: boolean;
  langSmithApiKey: string | null;
  langSmithEndpoint: string;
  langSmithProject: string;
  langSmithProjectId: string | null;
  langSmithWorkspaceId: string | null;
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

export type FleetGraphConditionType = 'stale_issue' | 'sprint_scope_creep' | 'unresolved_blocker' | 'orphaned_issue';
export type FleetGraphSeverity = 'info' | 'warning' | 'critical';

export interface FleetGraphCondition {
  type: FleetGraphConditionType;
  severity: FleetGraphSeverity;
  entityId: string;
  workspaceId: string;
  details: Record<string, unknown>;
}

export interface FleetGraphIssueRecord {
  id: string;
  workspaceId: string;
  title: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  updatedAt: string;
  state: string | null;
  sprintId: string | null;
  sprintTitle: string | null;
  projectId: string | null;
  projectTitle: string | null;
  hasBlockerText: boolean;
  blockerUpdatedAt?: string | null;
  createdAt: string;
}
