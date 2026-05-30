-- Remove old FleetGraph alerts with generic/unclear titles so they get re-generated on next proactive run
DELETE FROM fleetgraph_outputs
WHERE title LIKE 'FleetGraph:%'
   OR title = 'Stale issue detected'
   OR title = 'Sprint scope creep detected'
   OR title = 'Possible blocker detected'
   OR title = 'Orphaned issue detected'
   OR title = 'Action required: unresolved blocker';
