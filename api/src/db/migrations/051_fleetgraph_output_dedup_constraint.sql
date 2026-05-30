-- Remove duplicate active alerts, keeping the newest per condition+entity+recipient
DELETE FROM fleetgraph_outputs
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, condition_type, entity_id, recipient_user_id) id
  FROM fleetgraph_outputs
  ORDER BY workspace_id, condition_type, entity_id, recipient_user_id, created_at DESC
);
