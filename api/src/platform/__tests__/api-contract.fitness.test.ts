import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { z } from 'zod';

const app = createApp();

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  request_id: z.string().uuid(),
});

describe('API contract fitness — all v1 routes return ApiError shape on auth failure', () => {
  const routes = [
    { method: 'get', path: '/api/v1/docs' },
    { method: 'get', path: '/api/v1/docs/fake-id' },
    { method: 'post', path: '/api/v1/docs' },
    { method: 'get', path: '/api/v1/me' },
  ];

  for (const route of routes) {
    it(`${route.method.toUpperCase()} ${route.path} → ApiError shape without token`, async () => {
      const res = await (request(app) as any)[route.method](route.path);
      expect([401, 403, 400]).toContain(res.status);
      const parsed = apiErrorSchema.safeParse(res.body);
      expect(parsed.success, `Body was: ${JSON.stringify(res.body)}`).toBe(true);
    });
  }

  it('request_id is unique per request', async () => {
    const r1 = await request(app).get('/api/v1/docs');
    const r2 = await request(app).get('/api/v1/docs');
    expect(r1.body.request_id).not.toBe(r2.body.request_id);
  });
});
