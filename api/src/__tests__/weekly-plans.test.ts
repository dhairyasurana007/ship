import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Unit tests for weekly-plans and weekly-retros routes.
 *
 * All DB and auth dependencies are mocked so tests exercise only route-layer
 * logic: Zod validation, idempotency (200 vs 201), 404 handling, and
 * response shapes.
 *
 * POST / uses pool.connect() for transaction-safe writes; other routes use
 * pool.query() directly.
 */

// mockTxClient is declared with vi.hoisted so it's available inside the
// vi.mock factory below (vi.mock is hoisted before regular declarations).
const mockTxClient = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.workspaceId = 'test-workspace-id';
    next();
  }),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(mockTxClient),
  },
}));

vi.mock('../utils/document-content.js', () => ({
  extractText: vi.fn().mockReturnValue(''),
}));

import weeklyPlansRouter, { weeklyRetrosRouter } from '../routes/weekly-plans.js';
import { authMiddleware } from '../middleware/auth.js';
import { pool } from '../db/client.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/weekly-plans', weeklyPlansRouter);
  app.use('/weekly-retros', weeklyRetrosRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validPersonId = '00000000-0000-0000-0000-000000000001';

const personRow = { id: validPersonId, title: 'Alice Smith' };
const existingPlanRow = {
  id: 'plan-doc-id',
  title: 'Week 5',
  content: { type: 'doc', content: [] },
  properties: { person_id: validPersonId, week_number: 5 },
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

describe('Weekly Plans Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authMiddleware).mockImplementation(async (req: any, _res: any, next: any) => {
      req.userId = 'test-user-id';
      req.workspaceId = 'test-workspace-id';
      next();
    });

    // Reset the transaction client mock after clearAllMocks
    mockTxClient.query.mockReset();
    mockTxClient.release.mockReset();
    vi.mocked(pool.connect).mockResolvedValue(mockTxClient as any);

    app = createTestApp();
  });

  // -------------------------------------------------------------------------
  // Unauthenticated access
  // -------------------------------------------------------------------------

  describe('unauthenticated access', () => {
    beforeEach(() => {
      vi.mocked(authMiddleware).mockImplementation(async (_req: any, res: any) => {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
      });
    });

    it('POST /weekly-plans returns 401', async () => {
      const res = await request(app).post('/weekly-plans').send({});
      expect(res.status).toBe(401);
    });

    it('GET /weekly-plans returns 401', async () => {
      const res = await request(app).get('/weekly-plans');
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /weekly-plans — create or return existing plan
  // -------------------------------------------------------------------------

  describe('POST /weekly-plans', () => {
    it('returns 400 when person_id is missing', async () => {
      const res = await request(app)
        .post('/weekly-plans')
        .send({ week_number: 5 });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Invalid input' });
    });

    it('returns 400 when week_number is missing', async () => {
      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Invalid input' });
    });

    it('returns 400 when person_id is not a valid UUID', async () => {
      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: 'not-a-uuid', week_number: 5 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when week_number is less than 1', async () => {
      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId, week_number: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 404 when person is not found', async () => {
      mockTxClient.query.mockResolvedValueOnce({ rows: [] }); // person not found

      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId, week_number: 5 });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Person not found' });
      expect(mockTxClient.release).toHaveBeenCalled();
    });

    it('returns 200 when plan already exists (idempotent)', async () => {
      mockTxClient.query
        .mockResolvedValueOnce({ rows: [personRow] })        // person found
        .mockResolvedValueOnce({ rows: [existingPlanRow] }); // existing plan found

      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId, week_number: 5 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'plan-doc-id' });
      expect(mockTxClient.release).toHaveBeenCalled();
    });

    it('returns 201 when creating a new plan', async () => {
      const newDoc = {
        id: 'new-plan-id',
        title: 'Week 5 Plan',
        content: { type: 'doc', content: [] },
        properties: { person_id: validPersonId, week_number: 5 },
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      };

      mockTxClient.query
        .mockResolvedValueOnce({ rows: [personRow] }) // person found
        .mockResolvedValueOnce({ rows: [] })           // no existing plan
        .mockResolvedValueOnce({ rows: [] })           // BEGIN
        .mockResolvedValueOnce({ rows: [newDoc] })     // INSERT RETURNING
        .mockResolvedValueOnce({ rows: [] });          // COMMIT

      const res = await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId, week_number: 5 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'new-plan-id', document_type: 'weekly_plan' });
      expect(mockTxClient.release).toHaveBeenCalled();
    });

    it('releases the connection even when an error occurs', async () => {
      mockTxClient.query.mockRejectedValueOnce(new Error('DB error'));

      await request(app)
        .post('/weekly-plans')
        .send({ person_id: validPersonId, week_number: 5 });

      expect(mockTxClient.release).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /weekly-plans
  // -------------------------------------------------------------------------

  describe('GET /weekly-plans', () => {
    it('returns 200 with an array of plans', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [existingPlanRow] } as any);

      const res = await request(app).get('/weekly-plans');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 200 with empty array when no plans exist', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/weekly-plans');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /weekly-plans/:id
  // -------------------------------------------------------------------------

  describe('GET /weekly-plans/:id', () => {
    it('returns 404 when plan not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/weekly-plans/nonexistent-id');
      expect(res.status).toBe(404);
    });

    it('returns 200 with plan data when found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [existingPlanRow] } as any);

      const res = await request(app).get('/weekly-plans/plan-doc-id');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'plan-doc-id' });
    });
  });

  // -------------------------------------------------------------------------
  // GET /weekly-plans/:id/history
  // -------------------------------------------------------------------------

  describe('GET /weekly-plans/:id/history', () => {
    it('returns 200 with a history array', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'plan-doc-id' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/weekly-plans/plan-doc-id/history');
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // POST /weekly-retros — same idempotency pattern
  // -------------------------------------------------------------------------

  describe('POST /weekly-retros', () => {
    it('returns 400 when person_id is missing', async () => {
      const res = await request(app)
        .post('/weekly-retros')
        .send({ week_number: 5 });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Invalid input' });
    });

    it('returns 404 when person is not found', async () => {
      mockTxClient.query.mockResolvedValueOnce({ rows: [] }); // person not found

      const res = await request(app)
        .post('/weekly-retros')
        .send({ person_id: validPersonId, week_number: 5 });

      expect(res.status).toBe(404);
      expect(mockTxClient.release).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /weekly-retros
  // -------------------------------------------------------------------------

  describe('GET /weekly-retros', () => {
    it('returns 200 with retros array', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/weekly-retros');
      expect(res.status).toBe(200);
    });
  });
});
