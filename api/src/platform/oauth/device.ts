import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { deviceStore } from './deviceStore.js';

const router = Router();

const DEVICE_CODE_TTL_SECONDS = 900;
const POLLING_INTERVAL = 5;
const SLOW_DOWN_INTERVAL = 10;
const SLOW_DOWN_WINDOW_MS = 4000; // if polled within 4s, slow_down

function generateUserCode(): string {
  // RFC 8628 §6.1 — 8 chars, uppercase, easy to type
  const chars = 'BCDFGHJKLMNPQRSTVWXZ';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

// POST /oauth/device/code
router.post('/code', async (req: Request, res: Response): Promise<void> => {
  const { client_id, scope } = req.body as Record<string, string | undefined>;

  if (!client_id) {
    res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
    return;
  }

  const appResult = await pool.query(`SELECT id FROM oauth_apps WHERE client_id = $1`, [client_id]);
  if (appResult.rows.length === 0) {
    res.status(400).json({ error: 'invalid_client' });
    return;
  }

  const deviceCode = crypto.randomBytes(32).toString('hex');
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000);

  await deviceStore.set(deviceCode, {
    deviceCode,
    userCode,
    clientId: client_id,
    scope: scope ?? '',
    expiresAt,
    approved: false,
    userId: null,
    lastPolledAt: null,
  });

  res.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${process.env['APP_BASE_URL'] ?? 'https://ship-api-ysxi.onrender.com'}/oauth/device`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: POLLING_INTERVAL,
  });
});

// GET /oauth/device — form for entering user code
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const prefill = req.query['user_code'] as string | undefined;
  res.send(`<!DOCTYPE html>
<html>
<head><title>Activate Device</title></head>
<body>
  <h2>Activate Device</h2>
  <form method="POST" action="/oauth/device/verify">
    <label>Enter the code shown on your device:</label><br>
    <input type="text" name="user_code" value="${prefill ?? ''}" placeholder="XXXX-XXXX" required style="font-size:1.5em;letter-spacing:.2em;text-transform:uppercase"><br><br>
    <label>Email: <input type="email" name="email" required></label><br>
    <label>Password: <input type="password" name="password" required></label><br><br>
    <button type="submit">Approve</button>
  </form>
</body>
</html>`);
});

// POST /oauth/device/verify — user enters code + credentials
router.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { user_code, email } = req.body as Record<string, string | undefined>;

  if (!user_code || !email) {
    res.status(400).send('Missing user_code or email');
    return;
  }

  const entry = await deviceStore.getByUserCode(user_code);
  if (!entry) {
    res.status(400).send('Invalid or expired code. <a href="/oauth/device">Try again</a>');
    return;
  }

  if (new Date() > entry.expiresAt) {
    res.status(400).send('Code expired. <a href="/oauth/device">Try again</a>');
    return;
  }

  const userResult = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (userResult.rows.length === 0) {
    res.status(401).send('Invalid credentials. <a href="javascript:history.back()">Go back</a>');
    return;
  }

  const userId = (userResult.rows[0] as { id: string }).id;
  await deviceStore.approve(entry.deviceCode, userId);

  res.send(`<!DOCTYPE html>
<html>
<body>
  <h2>✓ Device Approved</h2>
  <p>You can close this window and return to your device.</p>
</body>
</html>`);
});

export default router;
