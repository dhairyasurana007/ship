-- Add poll_fallback to fleetgraph_runs trigger_type check constraint
ALTER TABLE fleetgraph_runs
  DROP CONSTRAINT fleetgraph_runs_trigger_type_check;

ALTER TABLE fleetgraph_runs
  ADD CONSTRAINT fleetgraph_runs_trigger_type_check
  CHECK (trigger_type IN ('schedule', 'pg_event', 'user_request', 'poll_fallback'));
