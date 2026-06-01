import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OAuthAppService } from '../OAuthAppService.js';
import { pool } from '../../../db/client.js';

const svc = new OAuthAppService();

describe('OAuthAppService', () => {
  let appId: string;

  it('createApp returns client_id and client_secret', async () => {
    const app = await svc.createApp({
      name: 'test-app',
      redirect_uris: ['http://localhost:9999/cb'],
      scopes: ['documents:read'],
    });
    expect(app.client_id).toBeTruthy();
    expect(app.client_secret).toHaveLength(64);
    appId = app.id;
  });

  it('getAppById does not return client_secret', async () => {
    const app = await svc.getAppById(appId);
    expect(app).toBeTruthy();
    expect((app as any).client_secret).toBeUndefined();
    expect((app as any).hashed_client_secret).toBeUndefined();
  });

  it('rotateSecret returns new 64-char secret', async () => {
    const result = await svc.rotateSecret(appId);
    expect(result.client_secret).toHaveLength(64);
  });

  afterAll(async () => {
    if (appId) await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
  });
});
