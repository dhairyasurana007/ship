import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';

const app = createApp();

describe('bearerAuth middleware', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/docs');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app).get('/api/v1/docs').set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });
});
