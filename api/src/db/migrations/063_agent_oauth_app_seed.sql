-- Seeds the FleetGraph system user and OAuth app for agent rewire (F11)
INSERT INTO users (id, email, name, role)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'fleetgraph@ship.internal',
  'FleetGraph',
  'admin'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO oauth_apps (client_id, hashed_client_secret, name, redirect_uris, owner_id, requested_scopes)
VALUES (
  '00000000-0000-0000-fleet-000000000001',
  'seed-placeholder-not-a-real-secret',
  'FleetGraph Agent',
  ARRAY[]::TEXT[],
  '00000000-0000-0000-0000-000000000001',
  ARRAY['documents:read', 'documents:write', 'issues:read', 'issues:write']
)
ON CONFLICT DO NOTHING;
