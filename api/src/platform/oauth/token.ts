import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../../db/client.js';
import { deviceStore } from './deviceStore.js';

const router = Router();

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'S256') {
    return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
  }
  return verifier === challenge;
}

async function issueAccessToken(
  appId: string,
  userId: string | null,
  scopes: string[],
  tokenKind: 'user' | 'machine' = 'user',
): Promise<string> {
  const accessToken = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO oauth_access_tokens (token, app_id, user_id, scopes, expires_at, token_kind)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [accessToken, appId, userId, scopes, new Date(Date.now() + 15 * 60 * 1000), tokenKind]
  );
  return accessToken;
}

async function issueTokenPair(appId: string, userId: string | null, scopes: string[]): Promise<{
  access_token: string; refresh_token: string;
}> {
  const accessToken = await issueAccessToken(appId, userId, scopes, 'user');
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const tokenResult = await pool.query(
    `SELECT id FROM oauth_access_tokens WHERE token = $1`,
    [accessToken]
  );

  await pool.query(
    `INSERT INTO oauth_refresh_tokens (token, access_token_id, app_id, user_id, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [refreshToken, (tokenResult.rows[0] as { id: string }).id,
     appId, userId, scopes, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)]
  );

  return { access_token: accessToken, refresh_token: refreshToken };
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, string | undefined>;
  const grant_type = body['grant_type'];

  // Authorization Code + PKCE
  if (grant_type === 'authorization_code') {
    const { code, code_verifier, redirect_uri, client_id } = body;
    if (!code || !code_verifier || !redirect_uri || !client_id) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' }); return;
    }

    const codeResult = await pool.query(
      `SELECT ac.*, oa.client_id as app_client_id
       FROM oauth_authorization_codes ac
       JOIN oauth_apps oa ON oa.id = ac.app_id
       WHERE ac.code = $1`, [code]
    );

    if (codeResult.rows.length === 0) { res.status(400).json({ error: 'invalid_grant', error_description: 'Code not found' }); return; }
    const row = codeResult.rows[0] as Record<string, unknown>;
    if (row['used_at']) { res.status(400).json({ error: 'invalid_grant', error_description: 'Code already used' }); return; }
    if (new Date(row['expires_at'] as string) < new Date()) { res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' }); return; }
    if (row['app_client_id'] !== client_id) { res.status(400).json({ error: 'invalid_client' }); return; }
    if (row['redirect_uri'] !== redirect_uri) { res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }); return; }
    if (!verifyPkce(code_verifier, row['code_challenge'] as string, (row['code_challenge_method'] as string) ?? 'S256')) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' }); return;
    }

    await pool.query(`UPDATE oauth_authorization_codes SET used_at = NOW() WHERE code = $1`, [code]);
    const appResult = await pool.query(`SELECT id FROM oauth_apps WHERE client_id = $1`, [client_id]);
    const appId = (appResult.rows[0] as { id: string }).id;
    const tokens = await issueTokenPair(appId, row['user_id'] as string, row['scopes'] as string[]);

    res.json({ ...tokens, token_type: 'Bearer', expires_in: 900, scope: (row['scopes'] as string[]).join(' ') });
    return;
  }

  // Client Credentials
  if (grant_type === 'client_credentials') {
    const { client_id, client_secret, scope } = body;
    if (!client_id || !client_secret) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing client_id or client_secret' }); return;
    }

    const appResult = await pool.query(
      `SELECT id, client_id, hashed_client_secret, owner_id, requested_scopes
       FROM oauth_apps
       WHERE client_id = $1`,
      [client_id]
    );
    if (appResult.rows.length === 0) { res.status(400).json({ error: 'invalid_client' }); return; }

    const app = appResult.rows[0] as Record<string, unknown>;
    const secretMatch = await bcrypt.compare(client_secret, String(app['hashed_client_secret'] ?? ''));
    if (!secretMatch) {
      res.status(400).json({ error: 'invalid_client' }); return;
    }

    const allowedScopes = Array.isArray(app['requested_scopes'])
      ? (app['requested_scopes'] as string[])
      : [];
    const requestedScopes = String(scope ?? '').trim().split(/\s+/).filter(Boolean);
    const effectiveScopes = requestedScopes.length > 0 ? requestedScopes : allowedScopes;
    const invalidScope = effectiveScopes.some((requestedScope) => !allowedScopes.includes(requestedScope));
    if (invalidScope) {
      res.status(400).json({ error: 'invalid_scope', error_description: 'Requested scope is not allowed for this client' }); return;
    }

    const accessToken = await issueAccessToken(
      String(app['id']),
      app['owner_id'] ? String(app['owner_id']) : null,
      effectiveScopes,
      'machine'
    );
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      scope: effectiveScopes.join(' '),
    });
    return;
  }

  // Device Authorization Grant
  if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
    const { device_code, client_id } = body;
    if (!device_code || !client_id) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing device_code or client_id' }); return;
    }

    const entry = await deviceStore.getByDeviceCode(device_code);
    if (!entry) { res.status(400).json({ error: 'expired_token', error_description: 'device_code not found or expired' }); return; }
    if (entry.clientId !== client_id) { res.status(400).json({ error: 'invalid_client' }); return; }
    if (new Date() > entry.expiresAt) {
      await deviceStore.delete(device_code);
      res.status(400).json({ error: 'expired_token' }); return;
    }

    // Slow down check â€” if polled within 4s of last poll
    const now = new Date();
    if (entry.lastPolledAt && (now.getTime() - entry.lastPolledAt.getTime()) < 4000) {
      await deviceStore.updateLastPolled(device_code);
      res.status(400).json({ error: 'slow_down', interval: 10 }); return;
    }

    await deviceStore.updateLastPolled(device_code);

    if (!entry.approved) {
      res.status(400).json({ error: 'authorization_pending' }); return;
    }

    // Approved â€” issue tokens
    const appResult = await pool.query(`SELECT id FROM oauth_apps WHERE client_id = $1`, [client_id]);
    if (appResult.rows.length === 0) { res.status(400).json({ error: 'invalid_client' }); return; }
    const appId = (appResult.rows[0] as { id: string }).id;
    const scopes = entry.scope.split(' ').filter(Boolean);
    const tokens = await issueTokenPair(appId, entry.userId, scopes);

    await deviceStore.delete(device_code);
    res.json({ ...tokens, token_type: 'Bearer', expires_in: 900, scope: entry.scope });
    return;
  }

  // Refresh Token Grant
  if (grant_type === 'refresh_token') {
    const { refresh_token } = body;
    if (!refresh_token) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token' }); return;
    }

    const rtResult = await pool.query(
      `SELECT rt.* FROM oauth_refresh_tokens rt WHERE rt.token = $1`,
      [refresh_token]
    );

    if (rtResult.rows.length === 0) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token not found' }); return;
    }

    const rt = rtResult.rows[0] as Record<string, unknown>;

    // Reuse detection â€” token already used: revoke entire family
    if (rt['used_at']) {
      await pool.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1`,
        [rt['family_id']]
      );
      await pool.query(
        `UPDATE oauth_access_tokens SET revoked_at = NOW()
         WHERE id IN (
           SELECT access_token_id FROM oauth_refresh_tokens WHERE family_id = $1
         )`,
        [rt['family_id']]
      );
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token already used â€” family revoked' }); return;
    }

    if (rt['revoked_at']) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }); return;
    }

    if (new Date(rt['expires_at'] as string) < new Date()) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token expired' }); return;
    }

    // Mark old token as used
    await pool.query(`UPDATE oauth_refresh_tokens SET used_at = NOW() WHERE token = $1`, [refresh_token]);

    // Issue new pair, preserving family_id
    const accessToken = crypto.randomBytes(32).toString('hex');
    const newRefreshToken = crypto.randomBytes(32).toString('hex');

    const newAtResult = await pool.query(
      `INSERT INTO oauth_access_tokens (token, app_id, user_id, scopes, expires_at, token_kind)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [accessToken, rt['app_id'], rt['user_id'], rt['scopes'], new Date(Date.now() + 15 * 60 * 1000), 'user']
    );

    await pool.query(
      `INSERT INTO oauth_refresh_tokens (token, access_token_id, app_id, user_id, scopes, expires_at, family_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newRefreshToken, (newAtResult.rows[0] as { id: string }).id,
       rt['app_id'], rt['user_id'], rt['scopes'],
       new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), rt['family_id']]
    );

    res.json({
      access_token: accessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: 900,
      scope: (rt['scopes'] as string[]).join(' '),
    });
    return;
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});

export default router;
