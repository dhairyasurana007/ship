-- Relax fleetgraph_state.project_id to TEXT so it can hold
-- either a workspace ID (for workspace-scoped proactive runs)
-- or a document/project ID (for project-scoped runs).
ALTER TABLE fleetgraph_state
  DROP CONSTRAINT fleetgraph_state_project_id_fkey;

ALTER TABLE fleetgraph_state
  ALTER COLUMN project_id TYPE TEXT USING project_id::TEXT;
