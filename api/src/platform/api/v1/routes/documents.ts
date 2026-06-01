import { Router } from 'express';
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
    const result = await pool.query(
      `SELECT id, title, document_type, created_at, updated_at
       FROM documents
       WHERE deleted_at IS NULL
       ${cursor ? 'AND id > $2' : ''}
       ORDER BY id ASC LIMIT $1`,
      cursor ? [limit + 1, cursor] : [limit + 1]
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
    const result = await pool.query(
      `SELECT id, title, document_type, content, properties, created_at, updated_at
       FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
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
    const result = await pool.query(
      `INSERT INTO documents (title, document_type, content, properties, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, document_type, created_at`,
      [title, document_type, content ?? null, properties ?? {}, req.auth?.userId ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

export default router;
