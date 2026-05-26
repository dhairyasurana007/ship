CREATE TABLE IF NOT EXISTS fleetgraph_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  entity_id UUID,
  mutation_type TEXT NOT NULL CHECK (mutation_type IN ('reassign_issue', 'move_issue_sprint', 'change_issue_state')),
  mutation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_approval_requests_workspace_status
  ON fleetgraph_approval_requests(workspace_id, status, created_at DESC);

