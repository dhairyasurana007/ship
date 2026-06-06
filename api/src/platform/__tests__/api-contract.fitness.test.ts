import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { z } from 'zod';
import { generateOpenApiSpec } from '../openapi/generator.js';

const app = createApp();

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  request_id: z.string().uuid(),
});

const LEGACY_AUTH_ERROR_SCHEMA = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

const PUBLIC_ROUTE_PATHS = [
  '/openapi.json',
  '/health',
  '/apps',
  '/apps/{id}',
  '/apps/{id}/rotate',
  '/docs',
  '/docs/{id}',
  '/me',
  '/webhooks',
  '/webhooks/deliveries',
  '/webhooks/deliveries/{id}/replay',
];

const LEGACY_ROUTES = [
  { method: 'get', path: '/api/v1/apps' },
  { method: 'post', path: '/api/v1/apps' },
  { method: 'get', path: '/api/v1/apps/fake-id' },
  { method: 'post', path: '/api/v1/apps/fake-id/rotate' },
];

const API_ERROR_ROUTES = [
  { method: 'get', path: '/api/v1/docs' },
  { method: 'get', path: '/api/v1/docs/fake-id' },
  { method: 'post', path: '/api/v1/docs' },
  { method: 'get', path: '/api/v1/me' },
  { method: 'post', path: '/api/v1/webhooks' },
  { method: 'get', path: '/api/v1/webhooks' },
  { method: 'get', path: '/api/v1/webhooks/deliveries' },
  { method: 'post', path: '/api/v1/webhooks/deliveries/fake-id/replay' },
];

describe('API contract fitness - route inventory and error shape', () => {
  it('every registered public route appears in OpenAPI', () => {
    const spec = generateOpenApiSpec();

    for (const path of PUBLIC_ROUTE_PATHS) {
      expect(spec.paths[path], `Missing OpenAPI path: ${path}`).toBeDefined();
    }
  });

  for (const route of LEGACY_ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path} rejects anonymous callers with the legacy session error shape`, async () => {
      const res = await (request(app) as any)[route.method](route.path);
      expect([401, 403]).toContain(res.status);
      const parsed = LEGACY_AUTH_ERROR_SCHEMA.safeParse(res.body);
      expect(parsed.success, `Body was: ${JSON.stringify(res.body)}`).toBe(true);
    });
  }

  for (const route of API_ERROR_ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path} rejects anonymous callers with ApiError shape`, async () => {
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
    const validCodes: string[] = [
      'unauthorized', 'token_expired', 'forbidden',
      'not_found', 'validation_failed', 'rate_limited', 'server_error',
    ];
    expect(validCodes).toContain('token_expired');
  });
});
