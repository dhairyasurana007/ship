import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { deviceStore } from './deviceStore.js';

const router = Router();

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'S256') {
    return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
  }
  return verifier === challenge;
}

async function issueTokenPair(appId: string, userId: string | null, scopes: string[]): Promise<{
  access_token: string; refresh_token: string;
}> {
  const accessToken = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');

  const tokenResult = await pool.query(
    `INSERT INTO oauth_access_tokens (token, app_id, user_id, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [accessToken, appId, userId, scopes, new Date(Date.now() + 15 * 60 * 1000)]
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

  // ── Authorization Code + PKCE ──────────────────────────────────────────────
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

  // ── Device Authorization Grant ─────────────────────────────────────────────
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

    // Slow down check — if polled within 4s of last poll
    const now = new Date();
    if (entry.lastPolledAt && (now.getTime() - entry.lastPolledAt.getTime()) < 4000) {
      await deviceStore.updateLastPolled(device_code);
      res.status(400).json({ error: 'slow_down', interval: 10 }); return;
    }

    await deviceStore.updateLastPolled(device_code);

    if (!entry.approved) {
      res.status(400).json({ error: 'authorization_pending' }); return;
    }

    // Approved — issue tokens
    const appResult = await pool.query(`SELECT id FROM oauth_apps WHERE client_id = $1`, [client_id]);
    if (appResult.rows.length === 0) { res.status(400).json({ error: 'invalid_client' }); return; }
    const appId = (appResult.rows[0] as { id: string }).id;
    const scopes = entry.scope.split(' ').filter(Boolean);
    const tokens = await issueTokenPair(appId, entry.userId, scopes);

    await deviceStore.delete(device_code);
    res.json({ ...tokens, token_type: 'Bearer', expires_in: 900, scope: entry.scope });
    return;
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});

export default router;
