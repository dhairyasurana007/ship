-- FleetGraph MVP persistence tables

CREATE TABLE IF NOT EXISTS fleetgraph_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule', 'pg_event', 'user_request')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  entity_id UUID,
  entity_type TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_workspace_created_at ON fleetgraph_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_status_created_at ON fleetgraph_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS fleetgraph_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_state_lookup ON fleetgraph_state(workspace_id, project_id, key);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_state_expires_at ON fleetgraph_state(expires_at);
