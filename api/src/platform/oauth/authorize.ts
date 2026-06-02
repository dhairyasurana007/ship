import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/client.js';

const router = Router();

declare module 'express-session' {
  interface SessionData {
    pendingOAuth?: {
      clientId: string;
      redirectUri: string;
      scope: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      state: string;
    };
  }
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const { client_id, redirect_uri, scope, code_challenge, code_challenge_method, state, response_type } = q;

  if (response_type !== 'code') { res.status(400).json({ error: 'unsupported_response_type' }); return; }
  if (!client_id || !redirect_uri || !code_challenge || !state) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' }); return;
  }

  const appResult = await pool.query(`SELECT id, name FROM oauth_apps WHERE client_id = $1`, [client_id]);
  if (appResult.rows.length === 0) { res.status(400).json({ error: 'invalid_client' }); return; }

  const app = appResult.rows[0] as { id: string; name: string };

  req.session.pendingOAuth = {
    clientId: client_id,
    redirectUri: redirect_uri,
    scope: scope ?? '',
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method ?? 'S256',
    state,
  };

  res.send(`<!DOCTYPE html>
<html>
<head><title>Authorize ${app.name}</title></head>
<body>
  <h2>Authorize ${app.name}</h2>
  <p>Requested scopes: <strong>${scope ?? 'none'}</strong></p>
  <form method="POST" action="/oauth/authorize">
    <label>Email: <input type="email" name="email" required></label><br>
    <label>Password: <input type="password" name="password" required></label><br>
    <button type="submit" name="action" value="approve">Approve</button>
    <button type="submit" name="action" value="deny">Deny</button>
  </form>
</body>
</html>`);
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { email, action } = req.body as Record<string, string>;
  const pending = req.session.pendingOAuth;

  if (!pending) { res.status(400).json({ error: 'invalid_request', error_description: 'No pending OAuth session' }); return; }

  if (action === 'deny') {
    delete req.session.pendingOAuth;
    const url = new URL(pending.redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('state', pending.state);
    res.redirect(url.toString()); return;
  }

  const authResult = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (authResult.rows.length === 0) {
    res.status(401).send('Invalid credentials. <a href="javascript:history.back()">Go back</a>'); return;
  }

  const userId = (authResult.rows[0] as { id: string }).id;
  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const appResult = await pool.query(`SELECT id FROM oauth_apps WHERE client_id = $1`, [pending.clientId]);
  const appId = (appResult.rows[0] as { id: string }).id;

  await pool.query(
    `INSERT INTO oauth_authorization_codes
     (code, app_id, user_id, scopes, redirect_uri, code_challenge, code_challenge_method, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [code, appId, userId, pending.scope.split(' ').filter(Boolean), pending.redirectUri,
     pending.codeChallenge, pending.codeChallengeMethod, expiresAt]
  );

  delete req.session.pendingOAuth;

  const url = new URL(pending.redirectUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', pending.state);
  res.redirect(url.toString());
});

export default router;
