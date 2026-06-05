import { Router } from 'express';
import { eventBus } from '../../../events/InMemoryEventBus.js';
import { z } from 'zod';
import { requireScope } from '../../../middleware/requireScope.js';
import { ApiError } from '../../../errors/ApiError.js';
import { registerRoute } from '../../../openapi/registerRoute.js';
import { pool } from '../../../../db/client.js';

const router = Router();

const createDocSchema = z.object({
  title: z.string().min(1).max(255),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person']).optional().default('wiki'),
  content: z.any().optional(),
  properties: z.record(z.unknown()).optional(),
});

registerRoute(router, 'get', '/docs', {
  operationId: 'listDocuments',
  summary: 'List documents',
  scope: 'documents:read',
}, requireScope('documents:read'), async (req, res, next) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = 50;
    // Resolve workspace for this token's user
    const wsResult = await pool.query(
      `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1`,
      [req.auth?.userId ?? null]
    );
    if (wsResult.rows.length === 0) throw new ApiError('forbidden', 'No workspace membership found for this token');
    const workspaceId = (wsResult.rows[0] as { workspace_id: string }).workspace_id;
    const result = await pool.query(
      `SELECT id, title, document_type, created_at, updated_at
       FROM documents
       WHERE workspace_id = $2 AND deleted_at IS NULL
       ${cursor ? 'AND id > $3' : ''}
       ORDER BY id ASC LIMIT $1`,
      cursor ? [limit + 1, workspaceId, cursor] : [limit + 1, workspaceId]
    );
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({ data, next_cursor: hasMore ? data[data.length - 1].id : null });
  } catch (err) { next(err); }
});

registerRoute(router, 'get', '/docs/:id', {
  operationId: 'getDocument',
  summary: 'Get document by ID',
  scope: 'documents:read',
}, requireScope('documents:read'), async (req, res, next) => {
  try {
    const wsResult = await pool.query(
      `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1`,
      [req.auth?.userId ?? null]
    );
    if (wsResult.rows.length === 0) throw new ApiError('forbidden', 'No workspace membership found for this token');
    const workspaceId = (wsResult.rows[0] as { workspace_id: string }).workspace_id;
    const result = await pool.query(
      `SELECT id, title, document_type, content, properties, created_at, updated_at
       FROM documents WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [req.params.id, workspaceId]
    );
    if (result.rows.length === 0) throw new ApiError('not_found', 'Document not found');
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

registerRoute(router, 'post', '/docs', {
  operationId: 'createDocument',
  summary: 'Create document',
  scope: 'documents:write',
  requestSchema: createDocSchema,
}, requireScope('documents:write'), async (req, res, next) => {
  try {
    const body = createDocSchema.safeParse(req.body);
    if (!body.success) throw new ApiError('validation_failed', 'Invalid request body', body.error.flatten());
    const { title, document_type, content, properties } = body.data;
    // Resolve workspace_id — required NOT NULL; pick the user's first workspace or the first workspace available
    const wsResult = await pool.query(
      `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1`,
      [req.auth?.userId ?? null]
    );
    if (wsResult.rows.length === 0) throw new ApiError('forbidden', 'No workspace membership found for this token');
    const workspaceId = (wsResult.rows[0] as { workspace_id: string }).workspace_id;
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, title, document_type, content, properties, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, document_type, created_at`,
      [workspaceId, title, document_type, content ?? null, properties ?? {}, req.auth?.userId ?? null]
    );
    res.status(201).json(result.rows[0]);
    // Fire event after response is sent — fully decoupled from request lifecycle
    setImmediate(() => {
      const doc = result.rows[0] as Record<string, unknown>;
      eventBus.publish({
        type: 'document.created',
        payload: { id: doc['id'], title: doc['title'], document_type: doc['document_type'] },
        timestamp: new Date().toISOString(),
      }).catch(console.error);
    });
  } catch (err) { next(err); }
});

export default router;
