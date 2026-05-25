import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Unit tests for CAIA auth routes (/api/auth/caia/*).
 *
 * All external OAuth, database, and audit dependencies are mocked so tests
 * exercise only route-layer logic: CAIA availability gating, OAuth state
 * handling, and redirect/JSON response shapes.
 */

vi.mock('../services/caia.js', () => ({
  isCAIAConfigured: vi.fn().mockResolvedValue(true),
  getAuthorizationUrl: vi.fn().mockResolvedValue({
    url: 'https://caia.example.gov/authorize?state=abc',
    state: 'test-state',
    nonce: 'test-nonce',
    codeVerifier: 'test-verifier',
  }),
  handleCallback: vi.fn(),
}));

vi.mock('../services/oauth-state.js', () => ({
  generateSecureSessionId: vi.fn().mockReturnValue('new-session-id'),
  storeOAuthState: vi.fn().mockResolvedValue(undefined),
  consumeOAuthState: vi.fn().mockResolvedValue({
    nonce: 'test-nonce',
    codeVerifier: 'test-verifier',
  }),
}));

vi.mock('../services/invite-acceptance.js', () => ({
  linkUserToWorkspaceViaInvite: vi.fn().mockResolvedValue({ isNewMembership: false }),
}));

vi.mock('../services/audit.js', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/client.js', () => ({
  pool: { query: vi.fn() },
}));

import caiaAuthRouter from '../routes/caia-auth.js';
import {
  isCAIAConfigured,
  getAuthorizationUrl,
  handleCallback,
} from '../services/caia.js';
import { consumeOAuthState, storeOAuthState } from '../services/oauth-state.js';
import { pool } from '../db/client.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Provide an empty req.cookies object so cookie reads don't throw
  app.use((req: any, _res: any, next: any) => {
    req.cookies = req.cookies || {};
    next();
  });
  app.use('/auth/caia', caiaAuthRouter);
  return app;
}

describe('CAIA Auth Routes (/api/auth/caia/*)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(isCAIAConfigured).mockResolvedValue(true);
    vi.mocked(getAuthorizationUrl).mockResolvedValue({
      url: 'https://caia.example.gov/authorize?state=abc',
      state: 'test-state',
      nonce: 'test-nonce',
      codeVerifier: 'test-verifier',
    } as any);
    vi.mocked(consumeOAuthState).mockResolvedValue({
      nonce: 'test-nonce',
      codeVerifier: 'test-verifier',
    } as any);
    vi.mocked(storeOAuthState).mockResolvedValue(undefined as any);

    app = createTestApp();
  });

  // -------------------------------------------------------------------------
  // GET /auth/caia/status
  // -------------------------------------------------------------------------

  describe('GET /auth/caia/status', () => {
    it('returns { available: true } when CAIA is configured', async () => {
      vi.mocked(isCAIAConfigured).mockResolvedValue(true);

      const res = await request(app).get('/auth/caia/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { available: true } });
    });

    it('returns { available: false } when CAIA is not configured', async () => {
      vi.mocked(isCAIAConfigured).mockResolvedValue(false);

      const res = await request(app).get('/auth/caia/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { available: false } });
    });
  });

  // -------------------------------------------------------------------------
  // GET /auth/caia/login
  // -------------------------------------------------------------------------

  describe('GET /auth/caia/login', () => {
    it('returns 503 when CAIA is not configured', async () => {
      vi.mocked(isCAIAConfigured).mockResolvedValue(false);

      const res = await request(app).get('/auth/caia/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        success: false,
        error: expect.objectContaining({ code: 'CAIA_NOT_CONFIGURED' }),
      });
    });

    it('returns authorization URL when CAIA is configured', async () => {
      const res = await request(app).get('/auth/caia/login');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: { authorizationUrl: expect.stringContaining('https://') },
      });
    });

    it('stores OAuth state after building authorization URL', async () => {
      await request(app).get('/auth/caia/login');
      expect(storeOAuthState).toHaveBeenCalledWith('test-state', 'test-nonce', 'test-verifier');
    });

    it('returns 500 when getAuthorizationUrl throws', async () => {
      vi.mocked(getAuthorizationUrl).mockRejectedValue(new Error('PKCE error'));

      const res = await request(app).get('/auth/caia/login');
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ error: expect.objectContaining({ code: 'CAIA_INIT_ERROR' }) });
    });
  });

  // -------------------------------------------------------------------------
  // GET /auth/caia/callback
  // -------------------------------------------------------------------------

  describe('GET /auth/caia/callback', () => {
    it('redirects to /login with error when OAuth server returns error param', async () => {
      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ error: 'access_denied', error_description: 'User denied access' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('redirects to /login when state parameter is missing', async () => {
      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ code: 'auth-code' }); // no state

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('redirects to /login when state is not found (expired/invalid)', async () => {
      vi.mocked(consumeOAuthState).mockResolvedValue(null as any);

      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ code: 'auth-code', state: 'unknown-state' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('redirects to / on successful callback for existing user with workspace', async () => {
      vi.mocked(handleCallback).mockResolvedValue({
        user: {
          email: 'alice@agency.gov',
          givenName: 'Alice',
          familyName: 'Smith',
          csp: 'test-csp',
        },
      } as any);

      // findUserByEmail, update last_auth_provider, (no old session to delete),
      // get workspaces, create session, update last_workspace_id
      vi.mocked(pool.query)
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-id',
            email: 'alice@agency.gov',
            name: 'Alice Smith',
            is_super_admin: false,
            last_workspace_id: 'ws-id',
          }],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any)   // update last_auth_provider
        .mockResolvedValueOnce({ rows: [{ id: 'ws-id', name: 'Workspace', role: 'member' }] } as any) // workspaces
        .mockResolvedValueOnce({ rows: [] } as any)   // insert session
        .mockResolvedValueOnce({ rows: [] } as any);  // update last_workspace_id

      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ code: 'valid-code', state: 'valid-state' });

      expect(res.status).toBe(302);
      // Should redirect to app root, not an error page
      expect(res.headers.location).not.toContain('error=');
    });

    it('redirects to /login when callback throws', async () => {
      vi.mocked(handleCallback).mockRejectedValue(new Error('Token exchange failed'));

      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ code: 'bad-code', state: 'valid-state' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('rejects invalid email format (non .gov/.mil)', async () => {
      vi.mocked(handleCallback).mockResolvedValue({
        user: {
          email: 'user@example.com', // not .gov/.mil
          givenName: 'Test',
          familyName: 'User',
        },
      } as any);

      const res = await request(app)
        .get('/auth/caia/callback')
        .query({ code: 'auth-code', state: 'valid-state' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });
  });
});
