-- Temporary super-admin elevations for security probe bootstrap accounts.
-- Enables deterministic privileged probe runs without permanently modifying users.
CREATE TABLE IF NOT EXISTS internal_probe_admin_elevations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  elevated_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_probe_admin_elevations_expires_at
  ON internal_probe_admin_elevations (expires_at);
