-- Composite partial index for issue list filtering.
-- Covers the common query pattern: filter issues by workspace, then optionally by
-- assignee_id and state (both stored in properties JSONB).
-- Partial index limited to active issues to keep it small and selective.
CREATE INDEX IF NOT EXISTS idx_documents_issue_filter
  ON documents (
    workspace_id,
    (properties->>'assignee_id'),
    (properties->>'state')
  )
  WHERE document_type = 'issue' AND deleted_at IS NULL;
