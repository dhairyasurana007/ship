-- Prevent duplicate active alerts for the same condition+entity+recipient
-- First remove any existing duplicates (keep the newest row per group)
DELETE FROM fleetgraph_outputs
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, condition_type, entity_id, recipient_user_id) id
  FROM fleetgraph_outputs
  ORDER BY workspace_id, condition_type, entity_id, recipient_user_id, created_at DESC
);

ALTER TABLE fleetgraph_outputs
  ADD CONSTRAINT fleetgraph_outputs_dedup
  UNIQUE (workspace_id, condition_type, entity_id, recipient_user_id);
