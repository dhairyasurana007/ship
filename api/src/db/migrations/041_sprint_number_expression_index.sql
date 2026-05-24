-- Expression index on sprint_number for fast sprint lookup by number.
-- sprint_number is stored in properties JSONB; this index avoids a full table scan
-- when querying sprints by number (e.g. seed.ts and claude.ts queries).
CREATE INDEX IF NOT EXISTS idx_documents_sprint_number
  ON documents ((properties->>'sprint_number'))
  WHERE document_type = 'sprint';
