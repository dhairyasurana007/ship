import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Unit/integration tests for AI analysis routes.
 *
 * All external dependencies (DB, auth, AWS Bedrock) are mocked so these
 * tests exercise only the route-layer logic: input validation, auth gating,
 * rate limiting, and error handling.
 */

// Mock the AI analysis service — prevents any real AWS Bedrock calls
vi.mock('../services/ai-analysis.js', () => ({
  analyzePlan: vi.fn(),
  analyzeRetro: vi.fn(),
  isAiAvailable: vi.fn().mockReturnValue(true),
  checkRateLimit: vi.fn().mockReturnValue(true),
}));

// Mock auth middleware as a vi.fn() so individual tests can override auth
// behaviour (e.g. returning 401 for unauthenticated tests).
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.workspaceId = 'test-workspace-id';
    next();
  }),
}));

// Mock pool to prevent stray DB calls inside imported modules
vi.mock('../db/client.js', () => ({
  pool: { query: vi.fn() },
}));

import aiRouter from '../routes/ai.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  analyzePlan,
  analyzeRetro,
  isAiAvailable,
  checkRateLimit,
} from '../services/ai-analysis.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const samplePlanContent = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Ship the login feature with OAuth' }],
            },
          ],
        },
      ],
    },
  ],
};

const sampleRetroContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Shipped the login feature – PR #42 merged to main.' },
      ],
    },
  ],
};

const planSuccessResult = {
  overall_score: 0.8,
  items: [
    {
      text: 'Ship the login feature with OAuth',
      score: 0.8,
      feedback: 'Clear deliverable with a concrete outcome.',
      issues: [],
      conciseness_score: 0.9,
      is_verbose: false,
      conciseness_feedback: '',
    },
  ],
  workload_assessment: 'moderate' as const,
  workload_feedback: 'Solid workload for the week.',
  content_hash: 'abc123hash',
};

const retroSuccessResult = {
  overall_score: 0.9,
  plan_coverage: [
    {
      plan_item: 'Ship the login feature with OAuth',
      addressed: true,
      has_evidence: true,
      feedback: 'PR merge is clear, verifiable evidence.',
    },
  ],
  suggestions: [],
  content_hash: 'def456hash',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI Routes (/api/ai/*)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply authenticated default after clearAllMocks resets the vi.fn()
    vi.mocked(authMiddleware).mockImplementation(async (req: any, _res: any, next: any) => {
      req.userId = 'test-user-id';
      req.workspaceId = 'test-workspace-id';
      next();
    });
    vi.mocked(isAiAvailable).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue(true);

    app = createTestApp();
  });

  // -------------------------------------------------------------------------
  // Unauthenticated access
  // -------------------------------------------------------------------------

  describe('unauthenticated access', () => {
    beforeEach(() => {
      vi.mocked(authMiddleware).mockImplementation(async (_req: any, res: any) => {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'No session found' },
        });
      });
    });

    it('GET /ai/status returns 401 when not authenticated', async () => {
      const res = await request(app).get('/ai/status');
      expect(res.status).toBe(401);
    });

    it('POST /ai/analyze-plan returns 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/ai/analyze-plan')
        .send({ content: samplePlanContent });
      expect(res.status).toBe(401);
    });

    it('POST /ai/analyze-retro returns 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent, plan_content: samplePlanContent });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /ai/status
  // -------------------------------------------------------------------------

  describe('GET /ai/status', () => {
    it('returns { available: true } when AI is available', async () => {
      vi.mocked(isAiAvailable).mockReturnValue(true);
      const res = await request(app).get('/ai/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true });
    });

    it('returns { available: false } when AI is unavailable', async () => {
      vi.mocked(isAiAvailable).mockReturnValue(false);
      const res = await request(app).get('/ai/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false });
    });
  });

  // -------------------------------------------------------------------------
  // POST /ai/analyze-plan
  // -------------------------------------------------------------------------

  describe('POST /ai/analyze-plan', () => {
    it('returns 400 when content is missing', async () => {
      const res = await request(app).post('/ai/analyze-plan').send({});
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'content is required' });
    });

    it('returns 200 with PlanAnalysisResult shape for valid content', async () => {
      vi.mocked(analyzePlan).mockResolvedValue(planSuccessResult);

      const res = await request(app)
        .post('/ai/analyze-plan')
        .send({ content: samplePlanContent });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        overall_score: expect.any(Number),
        items: expect.any(Array),
        workload_assessment: expect.any(String),
        workload_feedback: expect.any(String),
      });
    });

    it('passes the request content to analyzePlan', async () => {
      vi.mocked(analyzePlan).mockResolvedValue(planSuccessResult);

      await request(app)
        .post('/ai/analyze-plan')
        .send({ content: samplePlanContent });

      expect(analyzePlan).toHaveBeenCalledWith(samplePlanContent);
    });

    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(checkRateLimit).mockReturnValue(false);

      const res = await request(app)
        .post('/ai/analyze-plan')
        .send({ content: samplePlanContent });

      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Rate limit') });
    });

    it('returns { error: "ai_unavailable" } (not 500) when service throws', async () => {
      vi.mocked(analyzePlan).mockRejectedValue(new Error('Bedrock error'));

      const res = await request(app)
        .post('/ai/analyze-plan')
        .send({ content: samplePlanContent });

      // Route catches the error and returns a 200 with an error body
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ error: 'ai_unavailable' });
    });
  });

  // -------------------------------------------------------------------------
  // POST /ai/analyze-retro
  // -------------------------------------------------------------------------

  describe('POST /ai/analyze-retro', () => {
    it('returns 400 when retro_content is missing', async () => {
      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ plan_content: samplePlanContent });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'retro_content is required' });
    });

    it('returns 400 when plan_content is missing', async () => {
      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'plan_content is required' });
    });

    it('returns 200 with RetroAnalysisResult shape for valid content', async () => {
      vi.mocked(analyzeRetro).mockResolvedValue(retroSuccessResult);

      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent, plan_content: samplePlanContent });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        overall_score: expect.any(Number),
        plan_coverage: expect.any(Array),
        suggestions: expect.any(Array),
      });
    });

    it('passes retro and plan content to analyzeRetro', async () => {
      vi.mocked(analyzeRetro).mockResolvedValue(retroSuccessResult);

      await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent, plan_content: samplePlanContent });

      expect(analyzeRetro).toHaveBeenCalledWith(sampleRetroContent, samplePlanContent);
    });

    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(checkRateLimit).mockReturnValue(false);

      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent, plan_content: samplePlanContent });

      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ error: expect.stringContaining('Rate limit') });
    });

    it('returns { error: "ai_unavailable" } (not 500) when service throws', async () => {
      vi.mocked(analyzeRetro).mockRejectedValue(new Error('Bedrock error'));

      const res = await request(app)
        .post('/ai/analyze-retro')
        .send({ retro_content: sampleRetroContent, plan_content: samplePlanContent });

      // Route catches the error and returns a 200 with an error body
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ error: 'ai_unavailable' });
    });
  });
});
