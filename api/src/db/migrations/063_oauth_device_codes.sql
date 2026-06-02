CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES oauth_apps(client_id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_polled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_expires_at ON oauth_device_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_user_code ON oauth_device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_client_id ON oauth_device_codes(client_id);
