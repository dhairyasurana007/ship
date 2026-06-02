import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';

const app = createApp();
let createdAppId: string | null = null;

describe('appsRouter', () => {
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
    createdAppId = res.body.id;
  });

  it('fetching the app does not expose the secret', async () => {
    expect(createdAppId).toBeTruthy();
    const res = await request(app).get(`/api/v1/apps/${createdAppId}`);
    expect(res.status).toBe(200);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.hashed_client_secret).toBeUndefined();
  });
});

afterAll(async () => {
  if (createdAppId) {
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [createdAppId]);
  }
});
