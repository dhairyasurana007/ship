import { Router } from 'express';
import { pool } from '../../db/client.js';
import { requireScope } from '../middleware/requireScope.js';
import { registerRoute } from '../openapi/registerRoute.js';
import { retryScheduler } from './WebhookRetryScheduler.js';

const router = Router();

// GET /api/v1/webhooks/deliveries
registerRoute(router, 'get', '/webhooks/deliveries', {
  operationId: 'listWebhookDeliveries',
  summary: 'List webhook delivery attempts',
  scope: 'webhooks:manage',
});

router.get('/webhooks/deliveries', requireScope('webhooks:manage'), async (req, res): Promise<void> => {
  const appId = (req as unknown as { auth: { appId: string } }).auth.appId;
  const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;

  const result = await pool.query(
    `SELECT wd.id, wd.event_type, wd.attempt_number, wd.response_status,
            wd.latency_ms, wd.idempotency_key, wd.dead_lettered_at, wd.created_at
     FROM webhook_deliveries wd
     JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id
     WHERE ws.app_id = $1
       ${cursor ? 'AND wd.created_at < $2' : ''}
     ORDER BY wd.created_at DESC
     LIMIT 50`,
    cursor ? [appId, cursor] : [appId]
  );

  const rows = result.rows as Array<Record<string, unknown>>;
  const next_cursor = rows.length === 50 ? String(rows[rows.length - 1]?.['created_at']) : null;
  res.json({ data: rows, next_cursor });
});

// POST /api/v1/webhooks/deliveries/:id/replay
registerRoute(router, 'post', '/webhooks/deliveries/:id/replay', {
  operationId: 'replayWebhookDelivery',
  summary: 'Replay a webhook delivery',
  scope: 'webhooks:manage',
});

router.post('/webhooks/deliveries/:id/replay', requireScope('webhooks:manage'), async (req, res): Promise<void> => {
  await retryScheduler.replay(req.params['id'] as string);
  res.json({ queued: true });
});

export default router;
