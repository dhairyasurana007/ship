import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Unit tests for admin credentials routes (/api/admin/credentials/*).
 *
 * All external dependencies (AWS Secrets Manager, CAIA service, audit log,
 * DB, auth) are mocked so tests exercise only route-layer logic: auth/role
 * gating, input validation, success/error response shapes, and warning
 * propagation on failed issuer discovery.
 */

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (req: any, _res: any, next: any) => {
    req.userId = 'super-admin-user-id';
    req.workspaceId = 'test-workspace-id';
    next();
  }),
  superAdminMiddleware: vi.fn(async (_req: any, _res: any, next: any) => {
    next();
  }),
}));

vi.mock('../services/caia.js', () => ({
  isCAIAConfigured: vi.fn().mockResolvedValue(true),
  validateIssuerDiscovery: vi.fn().mockResolvedValue({ issuer: 'https://caia.example.gov' }),
  resetCAIAClient: vi.fn(),
}));

vi.mock('../services/secrets-manager.js', () => ({
  getCAIACredentials: vi.fn().mockResolvedValue({
    configured: true,
    credentials: {
      issuer_url: 'https://caia.example.gov',
      client_id: 'existing-client-id',
      client_secret: 'existing-secret',
    },
    error: null,
  }),
  saveCAIACredentials: vi.fn().mockResolvedValue(undefined),
  getCAIASecretPath: vi.fn().mockReturnValue('/ship/prod/caia-credentials'),
  getChangedFields: vi.fn().mockReturnValue(['client_secret']),
}));

vi.mock('../services/audit.js', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/client.js', () => ({
  pool: { query: vi.fn() },
}));

import adminCredentialsRouter from '../routes/admin-credentials.js';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import {
  isCAIAConfigured,
  validateIssuerDiscovery,
} from '../services/caia.js';
import {
  getCAIACredentials,
  saveCAIACredentials,
} from '../services/secrets-manager.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/credentials', adminCredentialsRouter);
  return app;
}

describe('Admin Credentials Routes (/api/admin/credentials/*)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated super-admin
    vi.mocked(authMiddleware).mockImplementation(async (req: any, _res: any, next: any) => {
      req.userId = 'super-admin-user-id';
      req.workspaceId = 'test-workspace-id';
      next();
    });
    vi.mocked(superAdminMiddleware).mockImplementation(async (_req: any, _res: any, next: any) => {
      next();
    });

    vi.mocked(isCAIAConfigured).mockResolvedValue(true);
    vi.mocked(validateIssuerDiscovery).mockResolvedValue({ issuer: 'https://caia.example.gov' } as any);
    vi.mocked(getCAIACredentials).mockResolvedValue({
      configured: true,
      credentials: {
        issuer_url: 'https://caia.example.gov',
        client_id: 'existing-client-id',
        client_secret: 'existing-secret',
      },
      error: null,
    } as any);
    vi.mocked(saveCAIACredentials).mockResolvedValue(undefined as any);

    app = createTestApp();
  });

  // -------------------------------------------------------------------------
  // Auth gating
  // -------------------------------------------------------------------------

  describe('auth gating', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(authMiddleware).mockImplementation(async (_req: any, res: any) => {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
      });

      const res = await request(app).get('/admin/credentials/status');
      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated but not super-admin', async () => {
      vi.mocked(superAdminMiddleware).mockImplementation(async (_req: any, res: any) => {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
      });

      const res = await request(app).get('/admin/credentials/status');
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/credentials (HTML page)
  // -------------------------------------------------------------------------

  describe('GET /admin/credentials', () => {
    it('returns 200 HTML page when authenticated as super-admin', async () => {
      const res = await request(app).get('/admin/credentials');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/credentials/status
  // -------------------------------------------------------------------------

  describe('GET /admin/credentials/status', () => {
    it('returns 200 with credential status shape', async () => {
      const res = await request(app).get('/admin/credentials/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: expect.objectContaining({
          configured: expect.any(Boolean),
          hasClientSecret: expect.any(Boolean),
        }),
      });
    });

    it('returns configured: true and clientId when credentials exist', async () => {
      const res = await request(app).get('/admin/credentials/status');
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.clientId).toBe('existing-client-id');
    });

    it('returns configured: false when credentials are not set', async () => {
      vi.mocked(getCAIACredentials).mockResolvedValue({
        configured: false,
        credentials: null,
        error: null,
      } as any);

      const res = await request(app).get('/admin/credentials/status');
      expect(res.status).toBe(200);
      expect(res.body.data.configured).toBe(false);
      expect(res.body.data.hasClientSecret).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/credentials/save
  // -------------------------------------------------------------------------

  describe('POST /admin/credentials/save', () => {
    it('returns 400 when issuer_url is missing', async () => {
      const res = await request(app)
        .post('/admin/credentials/save')
        .send({ client_id: 'my-client', client_secret: 'my-secret' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });

    it('returns 400 when client_id is missing', async () => {
      const res = await request(app)
        .post('/admin/credentials/save')
        .send({ issuer_url: 'https://caia.example.gov', client_secret: 'my-secret' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });

    it('returns 400 when no secret provided and no existing secret', async () => {
      vi.mocked(getCAIACredentials).mockResolvedValue({
        configured: false,
        credentials: null,
        error: null,
      } as any);

      const res = await request(app)
        .post('/admin/credentials/save')
        .send({ issuer_url: 'https://caia.example.gov', client_id: 'my-client' });
        // No client_secret, no existing credentials to fall back on

      expect(res.status).toBe(400);
    });

    it('returns 200 on successful save with discovery validation', async () => {
      const res = await request(app)
        .post('/admin/credentials/save')
        .send({
          issuer_url: 'https://caia.example.gov',
          client_id: 'new-client-id',
          client_secret: 'new-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: expect.any(String) });
      expect(saveCAIACredentials).toHaveBeenCalledOnce();
    });

    it('saves credentials even when issuer discovery fails (returns warning)', async () => {
      vi.mocked(validateIssuerDiscovery).mockRejectedValue(new Error('Discovery endpoint unreachable'));

      const res = await request(app)
        .post('/admin/credentials/save')
        .send({
          issuer_url: 'https://bad-issuer.example.gov',
          client_id: 'my-client',
          client_secret: 'my-secret',
        });

      // Route saves despite validation failure
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.warning).toBeTruthy();
      expect(saveCAIACredentials).toHaveBeenCalledOnce();
    });

    it('keeps existing secret when client_secret not provided', async () => {
      const res = await request(app)
        .post('/admin/credentials/save')
        .send({
          issuer_url: 'https://caia.example.gov',
          client_id: 'updated-client-id',
          // no client_secret — should fall back to 'existing-secret'
        });

      expect(res.status).toBe(200);
      expect(saveCAIACredentials).toHaveBeenCalledWith(
        expect.objectContaining({ client_secret: 'existing-secret' })
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/credentials/test-api
  // -------------------------------------------------------------------------

  describe('POST /admin/credentials/test-api', () => {
    it('returns 400 when CAIA is not configured', async () => {
      vi.mocked(isCAIAConfigured).mockResolvedValue(false);

      const res = await request(app).post('/admin/credentials/test-api');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });

    it('returns 200 on successful connection test', async () => {
      const res = await request(app).post('/admin/credentials/test-api');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        message: expect.stringContaining('successful'),
      });
    });

    it('returns 500 when discovery throws during test', async () => {
      vi.mocked(validateIssuerDiscovery).mockRejectedValue(new Error('Connection refused'));

      const res = await request(app).post('/admin/credentials/test-api');
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false });
    });
  });
});
