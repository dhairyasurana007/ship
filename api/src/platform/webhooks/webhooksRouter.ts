import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { requireScope } from '../middleware/requireScope.js';
import { registerRoute } from '../openapi/registerRoute.js';

const router = Router();

// POST /api/v1/webhooks — create subscription
registerRoute(router, 'post', '/webhooks', {
  operationId: 'createWebhook',
  summary: 'Register a webhook subscription',
  scope: 'webhooks:manage',
});

router.post('/webhooks', requireScope('webhooks:manage'), async (req, res): Promise<void> => {
  const { target_url, event_types = [] } = req.body as { target_url?: string; event_types?: string[] };
  if (!target_url) {
    res.status(400).json({ code: 'validation_failed', message: 'target_url is required' });
    return;
  }

  const signingSecret = crypto.randomBytes(32).toString('hex');
  const appId = (req as unknown as { auth: { appId: string } }).auth.appId;

  const result = await pool.query(
    `INSERT INTO webhook_subscriptions (app_id, target_url, event_types, signing_secret)
     VALUES ($1, $2, $3, $4) RETURNING id, target_url, event_types, created_at`,
    [appId, target_url, event_types, signingSecret]
  );

  res.status(201).json({ ...result.rows[0], signing_secret: signingSecret });
});

// GET /api/v1/webhooks — list subscriptions for the app
registerRoute(router, 'get', '/webhooks', {
  operationId: 'listWebhooks',
  summary: 'List webhook subscriptions',
  scope: 'webhooks:manage',
});

router.get('/webhooks', requireScope('webhooks:manage'), async (req, res): Promise<void> => {
  const appId = (req as unknown as { auth: { appId: string } }).auth.appId;
  const result = await pool.query(
    `SELECT id, target_url, event_types, enabled, created_at
     FROM webhook_subscriptions WHERE app_id = $1 ORDER BY created_at DESC`,
    [appId]
  );
  res.json({ data: result.rows });
});

export default router;
