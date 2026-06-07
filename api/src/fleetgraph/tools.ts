import { pool } from '../db/client.js';
import { getFleetGraphPublicClient, shouldUsePublicApi } from './public-api.js';

export type FleetGraphToolName =
  | 'create_document'
  | 'update_document'
  | 'delete_document'
  | 'delete_documents_by_title'
  | 'create_project'
  | 'update_project'
  | 'archive_project'
  | 'create_sprint'
  | 'move_item_to_sprint'
  | 'close_sprint'
  | 'update_work_item_fields'
  | 'link_documents'
  | 'unlink_documents'
  | 'search_entities'
  | 'bulk_edit_documents'
  | 'create_comment'
  | 'summarize_comment_thread'
  | 'get_timeline_changes'
  | 'validate_workspace_rules'
  | 'generate_sprint_review'
  | 'generate_project_health_report';

export interface FleetGraphToolCall {
  name: FleetGraphToolName;
  args: Record<string, unknown>;
}

export interface FleetGraphToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

const MAX_TITLE_LENGTH = 255;

function extractQuoted(prompt: string): string | null {
  const match = prompt.match(/"([^"]+)"/);
  const value = match?.[1] ?? null;
  // Bug #13: cap titles at 255 chars to match DB varchar limit
  return value ? value.substring(0, MAX_TITLE_LENGTH) : null;
}

function extractAfterPattern(prompt: string, pattern: RegExp): string | null {
  const match = prompt.match(pattern);
  const value = match?.[1]?.trim();
  return value ? value.replace(/[.?!]+$/, '').trim() : null;
}

function extractDocType(promptLower: string): string {
  if (promptLower.includes('issue')) return 'issue';
  if (promptLower.includes('project')) return 'project';
  if (promptLower.includes('program')) return 'program';
  if (promptLower.includes('sprint') || promptLower.includes('week')) return 'sprint';
  if (promptLower.includes('standup')) return 'standup';
  return 'wiki';
}

async function getUserAccess(workspaceId: string, userId: string): Promise<{ isSuperAdmin: boolean; workspaceRole: string | null }> {
  const [userRes, roleRes] = await Promise.all([
    pool.query('SELECT is_super_admin FROM users WHERE id = $1', [userId]),
    pool.query('SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]),
  ]);
  return {
    isSuperAdmin: Boolean(userRes.rows[0]?.is_super_admin),
    workspaceRole: roleRes.rows[0]?.role ?? null,
  };
}

async function requireAdmin(workspaceId: string, userId: string): Promise<FleetGraphToolResult | null> {
  const access = await getUserAccess(workspaceId, userId);
  const allowed = access.isSuperAdmin || access.workspaceRole === 'admin';
  if (allowed) return null;
  return { ok: false, summary: 'Not authorized. This action requires workspace admin or super-admin access.' };
}

function toTipTapDoc(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

type SearchEntityType = 'wiki' | 'issue' | 'project' | 'program' | 'sprint' | 'standup' | 'workspace';
type SearchStrategy = 'list' | 'structured' | 'hybrid';
type SearchTimeField = 'created_at' | 'updated_at';

export interface SearchPlan {
  entityTypes: SearchEntityType[];
  textQuery: string;
  limit: number;
  strategy: SearchStrategy;
  timeField: SearchTimeField;
  sortDirection: 'asc' | 'desc';
}

function inferEntityTypesFromQuery(lower: string): SearchEntityType[] {
  const entityTypes: SearchEntityType[] = [];
  if (lower.includes('project')) entityTypes.push('project');
  if (lower.includes('sprint') || lower.includes('week')) entityTypes.push('sprint');
  if (lower.includes('issue') || lower.includes('work item')) entityTypes.push('issue');
  if (lower.includes('program')) entityTypes.push('program');
  if (lower.includes('workspace')) entityTypes.push('workspace');
  if (lower.includes('document') || lower.includes('docs') || lower.includes('doc')) entityTypes.push('wiki');
  return entityTypes;
}

export function buildSearchPlan(args: Record<string, unknown>): SearchPlan {
  const rawQuery = String(args.query ?? '').trim();
  const lower = rawQuery.toLowerCase();
  const rawEntityTypes = Array.isArray(args.entityTypes)
    ? args.entityTypes.map((v) => String(v))
    : inferEntityTypesFromQuery(lower);
  const entityTypes = rawEntityTypes.filter((v): v is SearchEntityType =>
    ['wiki', 'issue', 'project', 'program', 'sprint', 'standup', 'workspace'].includes(v)
  );

  const numericLimit = Number(args.limit ?? 20);
  const limit = Number.isFinite(numericLimit) ? Math.min(50, Math.max(1, Math.floor(numericLimit))) : 20;

  const asksRecent = /(most recent|recent|latest|newest)/.test(lower);
  const asksOldest = /(oldest|earliest)/.test(lower);
  const timeField: SearchTimeField = /(created|creation|created at)/.test(lower) ? 'created_at' : 'updated_at';
  const sortDirection: 'asc' | 'desc' = asksOldest ? 'asc' : 'desc';

  let textQuery = rawQuery
    .replace(/\b(find|search|show|list|get)\b/gi, '')
    .replace(/\b(most recent|recent|latest|newest|oldest|earliest)\b/gi, '')
    .replace(/\b(created|creation|created at|updated|updated at)\b/gi, '')
    .replace(/\b(docs?|documents?|issues?|projects?|programs?|sprints?|weeks?|workspaces?)\b/gi, '')
    .replace(/\b(the|that|were|with|about|and|or|to|for|of|in|on|named)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (textQuery.length < 3) textQuery = '';
  const strategy: SearchStrategy = textQuery ? 'hybrid' : 'list';

  return {
    entityTypes,
    textQuery,
    limit,
    strategy: asksRecent || asksOldest ? 'list' : strategy,
    timeField,
    sortDirection,
  };
}

export function inferToolCallFromPrompt(input: {
  prompt: string;
  contextScope: 'workspace' | 'document';
  documentId?: string;
}): FleetGraphToolCall | null {
  const prompt = input.prompt.trim();
  const lower = prompt.toLowerCase();
  const isSearchLike = /(search|find|look up|lookup|fetch|retrieve|pull up)/.test(lower)
    || (/\b(show|list|get)\b/.test(lower) && /(recent|latest|newest|oldest|earliest)/.test(lower))
    || (/\b(what|which|who)\b/.test(lower) && /(issue|project|sprint|program|document|doc|team|member|assignee)/.test(lower));
  const inDocumentScope = input.contextScope === 'document' && Boolean(input.documentId);
  const hasDocNoun = /(document|doc|issue|project|program|sprint|week|standup|wiki)/.test(lower);

  if (/(create|add|new)\s+project/.test(lower)) {
    return { name: 'create_project', args: { title: extractQuoted(prompt) ?? 'Untitled' } };
  }
  if (/(archive|close)\s+project/.test(lower)) {
    const documentId = inDocumentScope ? input.documentId : null;
    return documentId ? { name: 'archive_project', args: { documentId } } : null;
  }
  if (/(update|edit|modify)\s+project/.test(lower)) {
    const documentId = inDocumentScope ? input.documentId : null;
    const targetTitle = extractQuoted(prompt) ?? extractAfterPattern(prompt, /project\s+(.+?)\s+title\s+to/i);
    const newTitle = extractAfterPattern(prompt, /(?:title\s+to)\s+\"?([^\"].*?)\"?$/i) ?? extractQuoted(prompt);
    if (!documentId && !targetTitle) return null;
    return {
      name: 'update_project',
      args: {
        ...(documentId ? { documentId } : {}),
        ...(targetTitle ? { targetTitle } : {}),
        title: newTitle,
      },
    };
  }
  if (/(create|add|new)\s+(sprint|week)/.test(lower)) {
    return { name: 'create_sprint', args: { title: extractQuoted(prompt) ?? 'Untitled' } };
  }
  if (/(close|complete)\s+(sprint|week)/.test(lower)) {
    const documentId = inDocumentScope ? input.documentId : null;
    return documentId ? { name: 'close_sprint', args: { sprintId: documentId } } : null;
  }
  if (/(move).*(issue|item).*(sprint|week)/.test(lower)) {
    const issueTitle = extractQuoted(prompt);
    const targetSprint = extractAfterPattern(prompt, /(?:to|into)\s+(?:sprint|week)\s+(.+)$/i);
    if (!issueTitle || !targetSprint) return null;
    return { name: 'move_item_to_sprint', args: { issueTitle, targetSprintTitle: targetSprint } };
  }
  if (/(set|update|change).*(status|assignee|priority)/.test(lower)) {
    const status = extractAfterPattern(prompt, /status\s+to\s+([a-z_ -]+?)(?:\s+for\s+|$)/i);
    const title = extractQuoted(prompt);
    if (!title) return null;
    return { name: 'update_work_item_fields', args: { issueTitle: title, status } };
  }
  if (/(unlink).*(document|doc)/.test(lower)) {
    const ids = prompt.match(/[0-9a-f]{8}-[0-9a-f-]{27}/gi) ?? [];
    if (ids.length < 2) return null;
    return { name: 'unlink_documents', args: { documentId: ids[0], relatedId: ids[1], relationshipType: 'parent' } };
  }
  if (/\blink\b.*(document|doc)/.test(lower)) {
    const ids = prompt.match(/[0-9a-f]{8}-[0-9a-f-]{27}/gi) ?? [];
    if (ids.length < 2) return null;
    return { name: 'link_documents', args: { documentId: ids[0], relatedId: ids[1], relationshipType: 'parent' } };
  }
  if (/(search).*(semantic|similar)/.test(lower)) {
    return {
      name: 'search_entities',
      args: {
        query: extractQuoted(prompt) ?? prompt,
        },
    };
  }
  if (isSearchLike) {
    const entityTypes = inferEntityTypesFromQuery(lower);
    return {
      name: 'search_entities',
      args: {
        query: extractQuoted(prompt) ?? prompt,
        entityTypes,
      },
    };
  }
  if (/(bulk).*(update|edit)/.test(lower)) {
    const title = extractQuoted(prompt);
    if (!title) return null;
    return { name: 'bulk_edit_documents', args: { title, setArchived: lower.includes('archive') } };
  }
  if (/(comment on|add comment)/.test(lower)) {
    const docId = inDocumentScope ? input.documentId : null;
    const content = extractQuoted(prompt) ?? extractAfterPattern(prompt, /(?:comment|note)\s*:?(.+)$/i);
    if (!docId || !content) return null;
    return { name: 'create_comment', args: { documentId: docId, content } };
  }
  if (/(summarize).*(comment|thread)/.test(lower)) {
    const docId = inDocumentScope ? input.documentId : null;
    if (!docId) return null;
    return { name: 'summarize_comment_thread', args: { documentId: docId } };
  }
  // A prompt that starts with a question word is a read request, not a command.
  // Prevents "what documents were deleted?" from routing to delete_document,
  // and "what happened in the history?" from routing to get_timeline_changes.
  const looksLikeQuestion = /^(what|which|where|when|who|how|can|could|would|is|are|do|does|did|have|has|tell me|show me)\b/i.test(lower);

  if (!looksLikeQuestion && /(timeline|history|audit)/.test(lower)) {
    return { name: 'get_timeline_changes', args: {} };
  }
  if (/(workspace rules|validate workspace|hygiene)/.test(lower)) {
    return { name: 'validate_workspace_rules', args: {} };
  }
  if (/(sprint review|week review)/.test(lower)) {
    const sprintTitle = extractQuoted(prompt);
    return { name: 'generate_sprint_review', args: { sprintTitle } };
  }
  if (/(project health|health report)/.test(lower)) {
    const projectTitle = extractQuoted(prompt);
    return { name: 'generate_project_health_report', args: { projectTitle } };
  }

  // Exclude prompts that begin with an update/rename verb — the "new" keyword
  // inside a quoted title (e.g. 'rename this to "My New Title"') would otherwise
  // incorrectly match the create branch before the rename branch is reached.
  if (/(create|add|new)\s+/.test(lower) && hasDocNoun && !/(update|edit|modify|rename|change)\s+/.test(lower)) {
    const title = extractQuoted(prompt) ?? 'Untitled';
    return { name: 'create_document', args: { documentType: extractDocType(lower), title } };
  }

  if (!looksLikeQuestion && /(delete|remove)\s+/.test(lower) && (hasDocNoun || inDocumentScope)) {
    if (input.contextScope === 'workspace') {
      const title = extractQuoted(prompt);
      if (!title) return null;
      return { name: 'delete_documents_by_title', args: { title } };
    }
    return { name: 'delete_document', args: { documentId: input.documentId } };
  }

  if (/(update|edit|modify|rename|change)\s+/.test(lower) && (hasDocNoun || inDocumentScope)) {
    const docId = input.contextScope === 'document' ? input.documentId : null;
    if (!docId) return null;
    const titleFromQuoted = (/title/.test(lower) || /rename/.test(lower)) ? extractQuoted(prompt) : null;
    const titleFromUnquoted = /rename|title/.test(lower)
      ? extractAfterPattern(prompt, /(?:rename(?:\s+this|\s+document)?\s+to|change(?:\s+the)?\s+title\s+to)\s+(.+)$/i)
      : null;
    const title = titleFromQuoted ?? titleFromUnquoted;
    const contentFromQuoted = /(content|text|body)/.test(lower) ? extractQuoted(prompt) : null;
    const contentFromUnquoted = /(content|text|body)/.test(lower)
      ? extractAfterPattern(prompt, /(?:update|change|set|edit|modify)(?:\s+the)?\s+(?:content|text|body)(?:\s+to)?\s+(.+)$/i)
      : null;
    const contentText = contentFromQuoted ?? contentFromUnquoted;
    // If neither title nor content was extracted, fall through to LLM — don't show a useless confirm
    if (!title && !contentText) return null;
    return {
      name: 'update_document',
      args: {
        documentId: docId,
        ...(title ? { title } : {}),
        ...(contentText ? { content: toTipTapDoc(contentText) } : {}),
      },
    };
  }

  return null;
}

export async function executeToolCall(input: {
  workspaceId: string;
  userId: string;
  toolCall: FleetGraphToolCall;
}): Promise<FleetGraphToolResult> {
  const { workspaceId, userId, toolCall } = input;

  if (toolCall.name === 'create_document') {
    if (shouldUsePublicApi()) {
      const client = await getFleetGraphPublicClient();
      const documentType = String(toolCall.args.documentType ?? 'wiki');
      const title = String(toolCall.args.title ?? 'Untitled');
      const created = await client.documents.create({
        title,
        document_type: documentType === 'wiki' ? 'wiki' : (documentType as 'issue' | 'program' | 'project' | 'sprint' | 'person'),
      });
      return {
        ok: true,
        summary: `Created ${created.document_type} document "${created.title}".`,
        data: { documentId: created.id, documentType: created.document_type, title: created.title },
      };
    }
    const documentType = String(toolCall.args.documentType ?? 'wiki');
    const title = String(toolCall.args.title ?? 'Untitled');
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, $2::document_type, $3, $4)
       RETURNING id, document_type, title`,
      [workspaceId, documentType, title, userId]
    );
    const row = result.rows[0];
    return { ok: true, summary: `Created ${row.document_type} document "${row.title}".`, data: { documentId: row.id, documentType: row.document_type, title: row.title } };
  }

  if (toolCall.name === 'update_document' || toolCall.name === 'update_project') {
    let documentId = String(toolCall.args.documentId ?? '');
    if (!documentId && toolCall.name === 'update_project') {
      const targetTitle = String(toolCall.args.targetTitle ?? '').trim();
      if (targetTitle) {
        const lookup = await pool.query(
          `SELECT id FROM documents
           WHERE workspace_id = $1 AND document_type = 'project' AND title = $2 AND deleted_at IS NULL
           ORDER BY updated_at DESC
           LIMIT 1`,
          [workspaceId, targetTitle]
        );
        documentId = String(lookup.rows[0]?.id ?? '');
      }
    }
    if (!documentId) return { ok: false, summary: 'Missing documentId for update.' };
    const title = typeof toolCall.args.title === 'string' && toolCall.args.title.trim() ? toolCall.args.title : null;
    const content = toolCall.args.content ?? null;
    if (title === null && content === null) return { ok: false, summary: 'No document changes were provided. Include a new title or content.' };
    const updates: string[] = ['updated_at = now()'];
    const values: unknown[] = [documentId, workspaceId];
    let idx = 3;
    if (title !== null) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (content !== null) {
      updates.push(`content = $${idx++}::jsonb`);
      values.push(JSON.stringify(content));
      updates.push('yjs_state = NULL');
    }
    const result = await pool.query(`UPDATE documents SET ${updates.join(', ')} WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING id, title`, values);
    if (result.rowCount === 0) return { ok: false, summary: 'Document not found in workspace.' };
    return { ok: true, summary: `Updated document "${result.rows[0].title}".`, data: { documentId: result.rows[0].id, title: result.rows[0].title } };
  }

  if (toolCall.name === 'delete_documents_by_title') {
    const title = String(toolCall.args.title ?? '').trim();
    if (!title) return { ok: false, summary: 'Missing title for workspace delete.' };
    const result = await pool.query(
      `UPDATE documents
       SET deleted_at = now(), updated_at = now()
       WHERE workspace_id = $1 AND deleted_at IS NULL AND archived_at IS NULL AND title = $2
       RETURNING id`,
      [workspaceId, title]
    );
    const deletedCount = result.rowCount ?? 0;
    if (deletedCount === 0) return { ok: false, summary: `No active documents found with title "${title}".` };
    return { ok: true, summary: `Deleted ${deletedCount} document${deletedCount === 1 ? '' : 's'} titled "${title}".`, data: { deletedCount, title } };
  }

  if (toolCall.name === 'delete_document') {
    const documentId = String(toolCall.args.documentId ?? '');
    if (!documentId) return { ok: false, summary: 'Missing documentId for delete.' };
    const result = await pool.query(
      `UPDATE documents SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING id, title`,
      [documentId, workspaceId]
    );
    if (result.rowCount === 0) return { ok: false, summary: 'Document not found or already deleted.' };
    return { ok: true, summary: `Deleted document "${result.rows[0].title}".`, data: { documentId: result.rows[0].id } };
  }

  if (toolCall.name === 'create_project') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const title = String(toolCall.args.title ?? 'Untitled');
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'project', $2, $3, '{}'::jsonb) RETURNING id, title`,
      [workspaceId, title, userId]
    );
    return { ok: true, summary: `Created project "${result.rows[0].title}".`, data: { documentId: result.rows[0].id } };
  }

  if (toolCall.name === 'archive_project') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const documentId = String(toolCall.args.documentId ?? '');
    const result = await pool.query(
      `UPDATE documents SET archived_at = now(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project' AND archived_at IS NULL
       RETURNING id, title`,
      [documentId, workspaceId]
    );
    if (result.rowCount === 0) return { ok: false, summary: 'Project not found or already archived.' };
    return { ok: true, summary: `Archived project "${result.rows[0].title}".`, data: { documentId: result.rows[0].id } };
  }

  if (toolCall.name === 'create_sprint') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const title = String(toolCall.args.title ?? 'Untitled');
    const sprintNumRes = await pool.query(
      `SELECT COALESCE(MAX((properties->>'sprint_number')::int), 0) + 1 AS next_num
       FROM documents WHERE workspace_id = $1 AND document_type = 'sprint'`,
      [workspaceId]
    );
    const sprintNumber = Number(sprintNumRes.rows[0]?.next_num ?? 1);
    const properties = { sprint_number: sprintNumber, assignee_ids: [] as string[], status: 'active' };
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', $2, $3, $4::jsonb) RETURNING id, title`,
      [workspaceId, title, userId, JSON.stringify(properties)]
    );
    return { ok: true, summary: `Created sprint "${result.rows[0].title}".`, data: { sprintId: result.rows[0].id, sprintNumber } };
  }

  if (toolCall.name === 'move_item_to_sprint') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const issueTitle = String(toolCall.args.issueTitle ?? '').trim();
    const targetSprintTitle = String(toolCall.args.targetSprintTitle ?? '').trim();
    if (!issueTitle || !targetSprintTitle) return { ok: false, summary: 'Missing issue title or target sprint title.' };
    const issueRes = await pool.query(
      `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'issue' AND title = $2 AND deleted_at IS NULL LIMIT 1`,
      [workspaceId, issueTitle]
    );
    const sprintRes = await pool.query(
      `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint' AND title ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
      [workspaceId, targetSprintTitle]
    );
    if (issueRes.rowCount === 0) return { ok: false, summary: `Issue "${issueTitle}" not found.` };
    if (sprintRes.rowCount === 0) return { ok: false, summary: `Sprint "${targetSprintTitle}" not found.` };
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [issueRes.rows[0].id, sprintRes.rows[0].id]
    );
    await pool.query(
      `DELETE FROM document_associations
       WHERE document_id = $1 AND relationship_type = 'sprint' AND related_id <> $2`,
      [issueRes.rows[0].id, sprintRes.rows[0].id]
    );
    return { ok: true, summary: `Moved "${issueTitle}" to sprint "${targetSprintTitle}".` };
  }

  if (toolCall.name === 'close_sprint') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const sprintId = String(toolCall.args.sprintId ?? '');
    if (!sprintId) return { ok: false, summary: 'Missing sprintId.' };
    const result = await pool.query(
      `UPDATE documents
       SET properties = jsonb_set(COALESCE(properties, '{}'::jsonb), '{status}', '\"closed\"'::jsonb, true),
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'`,
      [sprintId, workspaceId]
    );
    if (result.rowCount === 0) return { ok: false, summary: 'Sprint not found.' };
    return { ok: true, summary: 'Sprint closed.' };
  }

  if (toolCall.name === 'update_work_item_fields') {
    const title = String(toolCall.args.issueTitle ?? '').trim();
    const status = typeof toolCall.args.status === 'string' ? toolCall.args.status.trim() : null;
    if (!title || !status) return { ok: false, summary: 'Need issue title and status value.' };
    const result = await pool.query(
      `UPDATE documents
       SET properties = jsonb_set(COALESCE(properties, '{}'::jsonb), '{status}', to_jsonb($3::text), true),
           updated_at = now()
       WHERE workspace_id = $1 AND document_type = 'issue' AND title = $2 AND deleted_at IS NULL
       RETURNING id`,
      [workspaceId, title, status]
    );
    if (result.rowCount === 0) return { ok: false, summary: `Issue "${title}" not found.` };
    return { ok: true, summary: `Updated status for "${title}" to "${status}".`, data: { updatedCount: result.rowCount ?? 0 } };
  }

  if (toolCall.name === 'link_documents' || toolCall.name === 'unlink_documents') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const documentId = String(toolCall.args.documentId ?? '');
    const relatedId = String(toolCall.args.relatedId ?? '');
    const relationshipType = String(toolCall.args.relationshipType ?? 'parent');
    if (!documentId || !relatedId) return { ok: false, summary: 'Missing document IDs for link operation.' };
    if (toolCall.name === 'link_documents') {
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, $3::relationship_type)
         ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
        [documentId, relatedId, relationshipType]
      );
      return { ok: true, summary: 'Linked documents successfully.' };
    }
    await pool.query(
      `DELETE FROM document_associations WHERE document_id = $1 AND related_id = $2 AND relationship_type = $3::relationship_type`,
      [documentId, relatedId, relationshipType]
    );
    return { ok: true, summary: 'Unlinked documents successfully.' };
  }

  if (toolCall.name === 'search_entities') {
    const plan = buildSearchPlan(toolCall.args);
    const query = plan.textQuery;
    const entityTypes = plan.entityTypes;
    const orderFieldSql = plan.timeField === 'created_at' ? 'created_at' : 'updated_at';
    const orderDirectionSql = plan.sortDirection === 'asc' ? 'ASC' : 'DESC';

    // Enriched SELECT used for all document queries
    const enrichedSelect = `
      SELECT
        d.id, d.document_type AS type, d.title, d.created_at, d.updated_at,
        d.properties,
        assignee.name AS assignee_name,
        sprint_doc.id AS sprint_id, sprint_doc.title AS sprint_title,
        project_doc.id AS project_id, project_doc.title AS project_title,
        program_doc.id AS program_id, program_doc.title AS program_title
      FROM documents d
      LEFT JOIN users assignee ON assignee.id = (d.properties->>'assignee_id')::uuid
      LEFT JOIN document_associations sprint_assoc
        ON sprint_assoc.document_id = d.id AND sprint_assoc.relationship_type = 'sprint'
      LEFT JOIN documents sprint_doc ON sprint_doc.id = sprint_assoc.related_id
      LEFT JOIN document_associations project_assoc
        ON project_assoc.document_id = d.id AND project_assoc.relationship_type = 'project'
      LEFT JOIN documents project_doc ON project_doc.id = project_assoc.related_id
      LEFT JOIN document_associations program_assoc
        ON program_assoc.document_id = d.id AND program_assoc.relationship_type = 'program'
      LEFT JOIN documents program_doc ON program_doc.id = program_assoc.related_id
    `;

    const needsWorkspace = entityTypes.length === 0 || entityTypes.includes('workspace');

    // Docs query and workspace query run in parallel
    const docsPromise = plan.strategy === 'list'
      ? pool.query(
          `${enrichedSelect}
           WHERE d.workspace_id = $1
             AND d.deleted_at IS NULL
             AND (cardinality($2::text[]) = 0 OR d.document_type::text = ANY($2::text[]))
           ORDER BY d.${orderFieldSql} ${orderDirectionSql}
           LIMIT $3`,
          [workspaceId, entityTypes, plan.limit]
        )
      : pool.query(
          `${enrichedSelect}
           WHERE d.workspace_id = $1
             AND d.deleted_at IS NULL
             AND (cardinality($3::text[]) = 0 OR d.document_type::text = ANY($3::text[]))
             AND d.title ILIKE '%' || $2 || '%'
           ORDER BY d.${orderFieldSql} ${orderDirectionSql}
           LIMIT $4`,
          [workspaceId, query, entityTypes, plan.limit]
        );

    const wsPromise = needsWorkspace ? pool.query(
        `SELECT
           w.id, 'workspace'::text AS type, w.name AS title, w.created_at, w.updated_at,
           json_agg(json_build_object(
             'user_id', u.id,
             'name', u.name,
             'email', u.email,
             'role', wm2.role
           ) ORDER BY u.name) AS members
         FROM workspaces w
         JOIN workspace_memberships wm ON wm.workspace_id = w.id
         JOIN workspace_memberships wm2 ON wm2.workspace_id = w.id
         JOIN users u ON u.id = wm2.user_id
         WHERE wm.user_id = $1 AND w.archived_at IS NULL
           AND ($2 = '' OR w.name ILIKE '%' || $2 || '%')
         GROUP BY w.id, w.name, w.created_at, w.updated_at
         ORDER BY ${orderFieldSql} ${orderDirectionSql}
         LIMIT $3`,
        [userId, query, Math.min(5, plan.limit)]
      ) : Promise.resolve(null);

    // Await both in parallel
    const [docsResult, wsResult] = await Promise.all([docsPromise, wsPromise]);
    const docsStructuredRows = docsResult.rows;

    // Content fallback only if title search returned too few (sequential by necessity)
    let docsFallback: Array<Record<string, unknown>> = [];
    if (plan.strategy !== 'list' && docsStructuredRows.length < Math.ceil(plan.limit / 2)) {
      const fallbackRes = await pool.query(
        `${enrichedSelect}
         WHERE d.workspace_id = $1
           AND d.deleted_at IS NULL
           AND (cardinality($3::text[]) = 0 OR d.document_type::text = ANY($3::text[]))
           AND (d.content::text ILIKE '%' || $2 || '%' OR d.properties::text ILIKE '%' || $2 || '%')
         ORDER BY d.${orderFieldSql} ${orderDirectionSql}
         LIMIT $4`,
        [workspaceId, query, entityTypes, plan.limit]
      );
      docsFallback = fallbackRes.rows;
    }

    const workspaceResults = wsResult?.rows ?? [];

    const mergedById = new Map<string, Record<string, unknown>>();
    for (const row of [...docsStructuredRows, ...docsFallback, ...workspaceResults]) {
      const id = String(row.id);
      if (!mergedById.has(id)) mergedById.set(id, row);
    }
    const results = Array.from(mergedById.values()).slice(0, plan.limit);
    const titleSnippet = results
      .slice(0, 5)
      .map((r) => `"${String(r.title ?? 'Untitled')}"`)
      .join(', ');
    const ellipsis = results.length > 5 ? `, …` : '';
    return {
      ok: true,
      summary: results.length === 0
        ? 'No matching entities found.'
        : `Found ${results.length} matching entit${results.length === 1 ? 'y' : 'ies'}: ${titleSnippet}${ellipsis}.`,
      data: { results, plan },
    };
  }

  if (toolCall.name === 'bulk_edit_documents') {
    const denied = await requireAdmin(workspaceId, userId);
    if (denied) return denied;
    const title = String(toolCall.args.title ?? '').trim();
    const setArchived = Boolean(toolCall.args.setArchived);
    if (!title) return { ok: false, summary: 'Missing title for bulk edit.' };
    const result = await pool.query(
      setArchived
        ? `UPDATE documents SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND title = $2 AND deleted_at IS NULL RETURNING id`
        : `UPDATE documents SET updated_at = now() WHERE workspace_id = $1 AND title = $2 AND deleted_at IS NULL RETURNING id`,
      [workspaceId, title]
    );
    return { ok: true, summary: `Bulk edit updated ${result.rowCount ?? 0} documents.`, data: { updatedCount: result.rowCount ?? 0 } };
  }

  if (toolCall.name === 'create_comment') {
    const documentId = String(toolCall.args.documentId ?? '');
    const content = String(toolCall.args.content ?? '').trim();
    if (!documentId || !content) return { ok: false, summary: 'Missing documentId or comment content.' };
    const threadIdRes = await pool.query('SELECT gen_random_uuid()::text AS id');
    const commentId = String(threadIdRes.rows[0]?.id ?? '');
    const result = await pool.query(
      `INSERT INTO comments (document_id, comment_id, parent_id, author_id, workspace_id, content)
       VALUES ($1, $2, NULL, $3, $4, $5)
       RETURNING id`,
      [documentId, commentId, userId, workspaceId, content]
    );
    return { ok: true, summary: 'Comment created.', data: { commentRecordId: result.rows[0].id } };
  }

  if (toolCall.name === 'summarize_comment_thread') {
    const documentId = String(toolCall.args.documentId ?? '');
    if (!documentId) return { ok: false, summary: 'Missing documentId for comment summary.' };
    const result = await pool.query(
      `SELECT content, created_at FROM comments WHERE workspace_id = $1 AND document_id = $2 ORDER BY created_at DESC LIMIT 10`,
      [workspaceId, documentId]
    );
    if ((result.rowCount ?? 0) === 0) return { ok: true, summary: 'No comments found for this document.' };
    const snippets = result.rows.map((r) => String(r.content)).slice(0, 5);
    return { ok: true, summary: `Recent comment summary: ${snippets.join(' | ')}` };
  }

  if (toolCall.name === 'get_timeline_changes') {
    const result = await pool.query(
      `SELECT action, resource_type, resource_id, created_at
       FROM audit_logs
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [workspaceId]
    );
    return { ok: true, summary: `Loaded ${result.rowCount ?? 0} recent timeline events.`, data: { events: result.rows } };
  }

  if (toolCall.name === 'validate_workspace_rules') {
    const [untitledRes, orphanIssueRes, staleRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1 AND deleted_at IS NULL AND title = 'Untitled'`, [workspaceId]),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM documents d
         WHERE d.workspace_id = $1 AND d.document_type = 'issue' AND d.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM document_associations da
             WHERE da.document_id = d.id AND da.relationship_type = 'sprint'
           )`,
        [workspaceId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM documents
         WHERE workspace_id = $1 AND deleted_at IS NULL AND updated_at < now() - interval '30 days'`,
        [workspaceId]
      ),
    ]);
    const untitled = Number(untitledRes.rows[0]?.count ?? 0);
    const orphanIssues = Number(orphanIssueRes.rows[0]?.count ?? 0);
    const staleDocs = Number(staleRes.rows[0]?.count ?? 0);
    return { ok: true, summary: `Workspace checks: untitled=${untitled}, issues_without_sprint=${orphanIssues}, stale_docs=${staleDocs}.`, data: { untitled, orphanIssues, staleDocs } };
  }

  if (toolCall.name === 'generate_sprint_review') {
    const sprintTitle = String(toolCall.args.sprintTitle ?? '').trim();
    const sprintFilter = sprintTitle ? `AND s.title ILIKE $2` : '';
    const params: unknown[] = sprintTitle ? [workspaceId, sprintTitle] : [workspaceId];
    const sprintRes = await pool.query(
      `SELECT s.id, s.title
       FROM documents s
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint' AND s.deleted_at IS NULL ${sprintFilter}
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      params
    );
    if (sprintRes.rowCount === 0) return { ok: false, summary: 'Sprint not found for review.' };
    const sprintId = sprintRes.rows[0].id;
    const issuesRes = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE d.properties->>'status' = 'done')::int AS done
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'sprint'
       WHERE d.workspace_id = $1 AND d.document_type = 'issue' AND da.related_id = $2 AND d.deleted_at IS NULL`,
      [workspaceId, sprintId]
    );
    const total = Number(issuesRes.rows[0]?.total ?? 0);
    const done = Number(issuesRes.rows[0]?.done ?? 0);
    return { ok: true, summary: `Sprint review for "${sprintRes.rows[0].title}": ${done}/${total} issues marked done.` };
  }

  if (toolCall.name === 'generate_project_health_report') {
    const projectTitle = String(toolCall.args.projectTitle ?? '').trim();
    const projectFilter = projectTitle ? `AND p.title ILIKE $2` : '';
    const params: unknown[] = projectTitle ? [workspaceId, projectTitle] : [workspaceId];
    const projectRes = await pool.query(
      `SELECT p.id, p.title
       FROM documents p
       WHERE p.workspace_id = $1 AND p.document_type = 'project' AND p.deleted_at IS NULL ${projectFilter}
       ORDER BY p.updated_at DESC
       LIMIT 1`,
      params
    );
    if (projectRes.rowCount === 0) return { ok: false, summary: 'Project not found for health report.' };
    const issueRes = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE d.properties->>'status' IN ('blocked', 'at_risk'))::int AS at_risk
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'project'
       WHERE d.workspace_id = $1 AND d.document_type = 'issue' AND da.related_id = $2 AND d.deleted_at IS NULL`,
      [workspaceId, projectRes.rows[0].id]
    );
    const total = Number(issueRes.rows[0]?.total ?? 0);
    const atRisk = Number(issueRes.rows[0]?.at_risk ?? 0);
    return { ok: true, summary: `Project health for "${projectRes.rows[0].title}": total issues=${total}, at-risk=${atRisk}.` };
  }

  return { ok: false, summary: `Unsupported tool: ${toolCall.name}` };
}
