-- Trigger function for documents table
CREATE OR REPLACE FUNCTION notify_document_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'document_changes',
    json_build_object(
      'workspaceId', NEW.workspace_id,
      'entityId',    NEW.id,
      'entityType',  'document',
      'updatedAt',   NEW.updated_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fleetgraph_document_changes
  AFTER INSERT OR UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION notify_document_change();

-- Trigger function for document_associations table (no workspace_id column — look it up)
CREATE OR REPLACE FUNCTION notify_association_change()
RETURNS TRIGGER AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM documents WHERE id = NEW.document_id;

  IF v_workspace_id IS NOT NULL THEN
    PERFORM pg_notify(
      'document_changes',
      json_build_object(
        'workspaceId', v_workspace_id,
        'entityId',    NEW.document_id,
        'entityType',  'document_association',
        'updatedAt',   now()
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fleetgraph_association_changes
  AFTER INSERT OR UPDATE ON document_associations
  FOR EACH ROW
  EXECUTE FUNCTION notify_association_change();

-- Trigger function for comments table
CREATE OR REPLACE FUNCTION notify_comment_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'document_changes',
    json_build_object(
      'workspaceId', NEW.workspace_id,
      'entityId',    NEW.document_id,
      'entityType',  'comment',
      'updatedAt',   NEW.updated_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fleetgraph_comment_changes
  AFTER INSERT OR UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment_change();
