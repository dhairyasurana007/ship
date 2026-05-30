CREATE TABLE IF NOT EXISTS fleetgraph_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  output_kind TEXT NOT NULL CHECK (output_kind IN ('notification', 'action_required', 'digest')),
  entity_id UUID,
  entity_type TEXT,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_outputs_workspace_created_at
  ON fleetgraph_outputs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_outputs_workspace_recipient
  ON fleetgraph_outputs(workspace_id, recipient_user_id, created_at DESC);
