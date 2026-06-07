import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { pool } from '../../../db/client.js';

vi.mock('../../../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (req: any, _res: any, next: any) => {
    req.userId = 'super-admin-user-id';
    req.isSuperAdmin = true;
    next();
  }),
  superAdminMiddleware: vi.fn(async (_req: any, _res: any, next: any) => {
    next();
  }),
}));

import appsRouter from '../appsRouter.js';
import { authMiddleware, superAdminMiddleware } from '../../../middleware/auth.js';

const createdAppIds: string[] = [];

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/apps', appsRouter);
  return app;
}

describe('appsRouter', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authMiddleware).mockImplementation(async (req: any, _res: any, next: any) => {
      req.userId = 'super-admin-user-id';
      req.isSuperAdmin = true;
      next();
    });
    vi.mocked(superAdminMiddleware).mockImplementation(async (_req: any, _res: any, next: any) => {
      next();
    });
    app = createTestApp();
  });

  it('creates an OAuth app and returns the secret once', async () => {
    const res = await request(app)
      .post('/api/v1/apps')
      .send({
        name: `ci-app-${Date.now()}`,
        redirect_uris: ['http://localhost:9999/cb'],
        scopes: ['documents:read'],
      });

    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toHaveLength(64);
    expect(res.body.hashed_client_secret).toBeUndefined();
    createdAppIds.push(res.body.id);
  });

  it('fetching the app does not expose the secret', async () => {
    const createRes = await request(app)
      .post('/api/v1/apps')
      .send({
        name: `ci-app-${Date.now()}`,
        redirect_uris: ['http://localhost:9999/cb'],
        scopes: ['documents:read'],
      });

    createdAppIds.push(createRes.body.id);

    const res = await request(app).get(`/api/v1/apps/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.hashed_client_secret).toBeUndefined();
  });

  it('requires super-admin access', async () => {
    vi.mocked(superAdminMiddleware).mockImplementation(async (_req: any, res: any) => {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Super-admin access required',
        },
      });
    });

    const gatedApp = createTestApp();
    const res = await request(gatedApp)
      .post('/api/v1/apps')
      .send({
        name: `ci-app-${Date.now()}`,
        redirect_uris: ['http://localhost:9999/cb'],
        scopes: ['documents:read'],
      });

    expect(res.status).toBe(403);
  });
});

afterAll(async () => {
  for (const appId of createdAppIds) {
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
  }
});
