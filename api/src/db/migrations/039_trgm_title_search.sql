-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on documents.title for fast ILIKE/similarity title searches.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block; the migration
-- runner wraps each migration in BEGIN/COMMIT, so a plain index build is used here.
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
  ON documents USING GIN (title gin_trgm_ops);
