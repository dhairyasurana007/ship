-- Seeds the FleetGraph system user and OAuth app for agent rewire (F11)
INSERT INTO users (id, email, name, role)
VALUES (
  '00000000-0000-0000-0000-0000000007f1',
  'fleetgraph@ship.internal',
  'FleetGraph',
  'admin'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO oauth_apps (client_id, hashed_client_secret, name, redirect_uris, owner_id, requested_scopes)
VALUES (
  '00000000-0000-0000-0000-0000000007f2',
  '$2b$12$SjxAEHYxDeZV2RdRiDhJiOBmlfIvNQmxSjRugTwLwOfIihkpfJfA2',
  'FleetGraph Agent',
  ARRAY[]::TEXT[],
  '00000000-0000-0000-0000-0000000007f1',
  ARRAY['documents:read', 'documents:write', 'issues:read', 'issues:write']
)
ON CONFLICT DO NOTHING;
