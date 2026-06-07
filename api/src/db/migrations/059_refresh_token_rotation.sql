ALTER TABLE oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family_id ON oauth_refresh_tokens(family_id);
