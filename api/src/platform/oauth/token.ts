import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/client.js';

const router = Router();

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'S256') {
    return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
  }
  return verifier === challenge;
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { grant_type, code, code_verifier, redirect_uri, client_id } = req.body as Record<string, string | undefined>;

  if (grant_type !== 'authorization_code') { res.status(400).json({ error: 'unsupported_grant_type' }); return; }
  if (!code || !code_verifier || !redirect_uri || !client_id) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' }); return;
  }

  const codeResult = await pool.query(
    `SELECT ac.*, oa.client_id as app_client_id
     FROM oauth_authorization_codes ac
     JOIN oauth_apps oa ON oa.id = ac.app_id
     WHERE ac.code = $1`,
    [code]
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

  const accessToken = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');

  const tokenResult = await pool.query(
    `INSERT INTO oauth_access_tokens (token, app_id, user_id, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [accessToken, row['app_id'], row['user_id'], row['scopes'],
     new Date(Date.now() + 15 * 60 * 1000)]
  );

  await pool.query(
    `INSERT INTO oauth_refresh_tokens (token, access_token_id, app_id, user_id, scopes, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [refreshToken, (tokenResult.rows[0] as { id: string }).id,
     row['app_id'], row['user_id'], row['scopes'],
     new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)]
  );

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: refreshToken,
    scope: (row['scopes'] as string[]).join(' '),
  });
});

export default router;
