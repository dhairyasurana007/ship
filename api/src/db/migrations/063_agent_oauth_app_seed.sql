-- Seeds the FleetGraph system user and OAuth app for agent rewire (F11)
WITH upserted_user AS (
  INSERT INTO users (id, email, name, is_super_admin)
  VALUES (
    '00000000-0000-0000-0000-0000000007f1',
    'fleetgraph@ship.internal',
    'FleetGraph',
    TRUE
  )
  ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name,
        is_super_admin = TRUE,
        updated_at = NOW()
  RETURNING id
)

INSERT INTO oauth_apps (client_id, hashed_client_secret, name, redirect_uris, owner_id, requested_scopes)
SELECT
  '00000000-0000-0000-0000-0000000007f2',
  '$2b$12$SjxAEHYxDeZV2RdRiDhJiOBmlfIvNQmxSjRugTwLwOfIihkpfJfA2',
  'FleetGraph Agent',
  ARRAY[]::TEXT[],
  id,
  ARRAY['documents:read', 'documents:write', 'issues:read', 'issues:write']
FROM upserted_user
ON CONFLICT DO NOTHING;
