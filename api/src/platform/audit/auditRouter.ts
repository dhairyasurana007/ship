import { Router } from 'express';
import { pool } from '../../db/client.js';
import { requireScope } from '../middleware/requireScope.js';
import { registerRoute } from '../openapi/registerRoute.js';

const router = Router();

registerRoute(router, 'get', '/audit', {
  operationId: 'listAuditTrail',
  summary: 'List public API audit trail entries',
  scope: 'webhooks:manage',
});

router.get('/audit', requireScope('webhooks:manage'), async (req, res, next): Promise<void> => {
  try {
    const appId = (req as unknown as { auth: { appId: string } }).auth.appId;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = 50;

    const result = await pool.query(
      `SELECT client_id, user_id, route, scope_used, http_status, latency_ms, request_id, created_at
       FROM public_api_audit
       WHERE client_id = $1
         ${cursor ? 'AND created_at < $2' : ''}
       ORDER BY created_at DESC
       LIMIT $3`,
      cursor ? [appId, cursor, limit] : [appId, limit],
    );

    const rows = result.rows as Array<Record<string, unknown>>;
    const next_cursor = rows.length === limit ? String(rows[rows.length - 1]?.['created_at']) : null;
    res.json({ data: rows, next_cursor });
  } catch (error) {
    next(error);
  }
});

export default router;
