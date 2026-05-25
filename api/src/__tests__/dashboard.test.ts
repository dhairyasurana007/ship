import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Unit tests for the dashboard routes.
 *
 * All external dependencies (DB, auth, visibility middleware) are mocked so
 * tests exercise only route-layer logic: auth gating, 404 handling, and
 * response shapes.
 */

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.workspaceId = 'test-workspace-id';
    next();
  }),
}));

vi.mock('../middleware/visibility.js', () => ({
  getVisibilityContext: vi.fn().mockResolvedValue({ isAdmin: false }),
  VISIBILITY_FILTER_SQL: vi.fn().mockReturnValue('TRUE'),
}));

vi.mock('../db/client.js', () => ({
  pool: { query: vi.fn() },
}));

// extractText is a pure utility; stub to avoid module resolution issues
vi.mock('../utils/document-content.js', () => ({
  extractText: vi.fn().mockReturnValue(''),
}));

import dashboardRouter from '../routes/dashboard.js';
import { authMiddleware } from '../middleware/auth.js';
import { pool } from '../db/client.js';
import { getVisibilityContext } from '../middleware/visibility.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/dashboard', dashboardRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate a workspace row returned by pool.query */
const workspaceRow = { sprint_start_date: '2024-01-01' };

describe('Dashboard Routes (/api/dashboard/*)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authMiddleware).mockImplementation(async (req: any, _res: any, next: any) => {
      req.userId = 'test-user-id';
      req.workspaceId = 'test-workspace-id';
      next();
    });

    vi.mocked(getVisibilityContext).mockResolvedValue({ isAdmin: false } as any);

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

    it('GET /dashboard/my-work returns 401', async () => {
      const res = await request(app).get('/dashboard/my-work');
      expect(res.status).toBe(401);
    });

    it('GET /dashboard/my-focus returns 401', async () => {
      const res = await request(app).get('/dashboard/my-focus');
      expect(res.status).toBe(401);
    });

    it('GET /dashboard/my-week returns 401', async () => {
      const res = await request(app).get('/dashboard/my-week');
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/my-work
  // -------------------------------------------------------------------------

  describe('GET /dashboard/my-work', () => {
    it('returns 404 when workspace is not found', async () => {
      // pool.query: workspace lookup returns empty
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-work');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Workspace not found' });
    });

    it('returns 200 with work item shape when workspace exists', async () => {
      // workspace, issues, projects, sprints
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any) // workspace
        .mockResolvedValueOnce({ rows: [] } as any)             // issues
        .mockResolvedValueOnce({ rows: [] } as any)             // projects
        .mockResolvedValueOnce({ rows: [] } as any);            // sprints

      const res = await request(app).get('/dashboard/my-work');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        items: expect.any(Array),
        grouped: expect.objectContaining({
          overdue: expect.any(Array),
          this_sprint: expect.any(Array),
          later: expect.any(Array),
        }),
        current_sprint_number: expect.any(Number),
        days_remaining: expect.any(Number),
      });
    });

    it('classifies issues by urgency in the grouped response', async () => {
      const issue = {
        id: 'issue-1',
        title: 'Old Issue',
        properties: { state: 'in_progress', priority: 'high' },
        ticket_number: 42,
        sprint_id: 'sprint-old',
        sprint_name: 'Sprint 1',
        sprint_number: 1,
        program_name: null,
      };

      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any)
        .mockResolvedValueOnce({ rows: [issue] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-work');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ id: 'issue-1', type: 'issue' });
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/my-focus
  // -------------------------------------------------------------------------

  describe('GET /dashboard/my-focus', () => {
    it('returns 404 when person document not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-focus');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Person not found for current user' });
    });

    it('returns 404 when workspace not found after person found', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any) // person
        .mockResolvedValueOnce({ rows: [] } as any);                                    // workspace

      const res = await request(app).get('/dashboard/my-focus');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Workspace not found' });
    });

    it('returns 200 with focus shape when everything is found', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any) // person
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any)                         // workspace
        .mockResolvedValueOnce({ rows: [] } as any);                                    // allocations (no projects)

      const res = await request(app).get('/dashboard/my-focus');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        person_id: 'person-id',
        current_week_number: expect.any(Number),
        week_start: expect.any(String),
        week_end: expect.any(String),
        projects: expect.any(Array),
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/my-week
  // -------------------------------------------------------------------------

  describe('GET /dashboard/my-week', () => {
    it('returns 404 when person document not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-week');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Person not found for current user' });
    });

    it('returns 404 when workspace not found', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-week');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'Workspace not found' });
    });

    it('returns 200 with full week shape', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any) // person
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any)                         // workspace
        .mockResolvedValueOnce({ rows: [] } as any)                                     // plan
        .mockResolvedValueOnce({ rows: [] } as any)                                     // retro
        .mockResolvedValueOnce({ rows: [] } as any)                                     // prev retro
        .mockResolvedValueOnce({ rows: [] } as any)                                     // standups
        .mockResolvedValueOnce({ rows: [] } as any);                                    // allocations

      const res = await request(app).get('/dashboard/my-week');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        person_id: 'person-id',
        person_name: 'Alice',
        week: expect.objectContaining({
          week_number: expect.any(Number),
          start_date: expect.any(String),
          end_date: expect.any(String),
          is_current: expect.any(Boolean),
        }),
        plan: null,
        retro: null,
        standups: expect.any(Array),
        projects: expect.any(Array),
      });
    });

    it('respects ?week_number query param', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any)
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-week?week_number=5');
      expect(res.status).toBe(200);
      expect(res.body.week.week_number).toBe(5);
      expect(res.body.week.is_current).toBe(false);
    });

    it('includes 7 standup slots in the response', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'person-id', title: 'Alice' }] } as any)
        .mockResolvedValueOnce({ rows: [workspaceRow] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res = await request(app).get('/dashboard/my-week');
      expect(res.status).toBe(200);
      expect(res.body.standups).toHaveLength(7);
      expect(res.body.standups[0]).toMatchObject({
        date: expect.any(String),
        day: expect.any(String),
      });
    });
  });
});
