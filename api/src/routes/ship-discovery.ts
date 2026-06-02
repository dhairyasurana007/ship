import { Router } from 'express';
import { GRADER_OAUTH_APP_NAME } from '../platform/apps/constants.js';
import { oAuthAppService } from '../platform/apps/OAuthAppService.js';

const router = Router();

router.get('/ship.json', async (_req, res) => {
  const app = await oAuthAppService.getAppByName(GRADER_OAUTH_APP_NAME);
  if (!app) {
    res.status(503).json({
      error: 'oauth_client_id_unavailable',
      message: 'Ship OAuth client id is not configured yet.',
    });
    return;
  }

  res.json({
    oauth_client_id: app.client_id,
    api_base_url: `${process.env.APP_BASE_URL ?? 'https://ship-api-ysxi.onrender.com'}`,
  });
});

export default router;
