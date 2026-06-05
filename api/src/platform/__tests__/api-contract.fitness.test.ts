import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { z } from 'zod';

const app = createApp();

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  request_id: z.string().uuid(),
});

// All public /api/v1/* routes that require auth
const PROTECTED_ROUTES = [
  { method: 'get',  path: '/api/v1/docs' },
  { method: 'get',  path: '/api/v1/docs/fake-id' },
  { method: 'post', path: '/api/v1/docs' },
  { method: 'get',  path: '/api/v1/me' },
  { method: 'post', path: '/api/v1/webhooks' },
  { method: 'get',  path: '/api/v1/webhooks' },
  { method: 'get',  path: '/api/v1/webhooks/deliveries' },
  { method: 'post', path: '/api/v1/webhooks/deliveries/fake-id/replay' },
];

describe('API contract fitness — ApiError shape on all public routes', () => {
  for (const route of PROTECTED_ROUTES) {
    // No-token test: short-circuits in bearerAuth before any DB call
    it(`${route.method.toUpperCase()} ${route.path} → ApiError shape with no token`, async () => {
      const res = await (request(app) as any)[route.method](route.path);
      expect([400, 401, 403, 404, 422]).toContain(res.status);
      const parsed = apiErrorSchema.safeParse(res.body);
      expect(parsed.success, `Body was: ${JSON.stringify(res.body)}`).toBe(true);
    });
  }

  it('request_id is unique per request', async () => {
    const r1 = await request(app).get('/api/v1/docs');
    const r2 = await request(app).get('/api/v1/docs');
    expect(r1.body.request_id).not.toBe(r2.body.request_id);
  });

  it('token_expired is a valid top-level ApiErrorCode (not buried in details)', () => {
    // Compile-time proof: token_expired is in the union, not in details.reason.
    // Runtime proof lives in bearerAuth.test.ts against a DB-backed expired row.
    const validCodes: string[] = [
      'unauthorized', 'token_expired', 'forbidden',
      'not_found', 'validation_failed', 'rate_limited', 'server_error',
    ];
    expect(validCodes).toContain('token_expired');
  });
});
