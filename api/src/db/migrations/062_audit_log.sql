CREATE TABLE IF NOT EXISTS public_api_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT,
  user_id UUID,
  route TEXT NOT NULL,
  scope_used TEXT,
  http_status INT NOT NULL,
  latency_ms INT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_api_audit_client_id ON public_api_audit(client_id);
CREATE INDEX IF NOT EXISTS idx_public_api_audit_created_at ON public_api_audit(created_at DESC);
