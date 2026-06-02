/**
 * Idempotent grader seed — creates a read-only OAuth app + pre-issued access token.
 * Run: pnpm db:seed:grader
 * Prints client_id and access token to stdout for inclusion in README.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../client.js';
import { GRADER_OAUTH_APP_NAME } from '../../platform/apps/constants.js';

const SCOPES = ['documents:read', 'issues:read'];
const TOKEN_TTL_DAYS = 90;

async function seed() {
  // Check if grader app already exists
  const existing = await pool.query(
    `SELECT id, client_id FROM oauth_apps WHERE name = $1`,
    [GRADER_OAUTH_APP_NAME]
  );

  let appId: string;
  let clientId: string;

  if (existing.rows.length > 0) {
    appId = existing.rows[0].id;
    clientId = existing.rows[0].client_id;
    console.log(`Grader app already exists — client_id: ${clientId}`);
  } else {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hashed = await bcrypt.hash(rawSecret, 12);
    const result = await pool.query(
      `INSERT INTO oauth_apps (hashed_client_secret, name, redirect_uris, requested_scopes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, client_id`,
      [hashed, GRADER_OAUTH_APP_NAME, [], SCOPES]
    );
    appId = result.rows[0].id;
    clientId = result.rows[0].client_id;
    console.log(`Created grader app — client_id: ${clientId}`);
  }

  // Revoke any existing grader tokens
  await pool.query(
    `UPDATE oauth_access_tokens SET revoked_at = NOW()
     WHERE app_id = $1 AND revoked_at IS NULL`,
    [appId]
  );

  // Issue a new long-lived read-only token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO oauth_access_tokens (token, app_id, user_id, scopes, expires_at)
     VALUES ($1, $2, NULL, $3, $4)`,
    [token, appId, SCOPES, expiresAt]
  );

  console.log('\n=== GRADER CREDENTIALS ===');
  console.log(`client_id:    ${clientId}`);
  console.log(`access_token: ${token}`);
  console.log(`scopes:       ${SCOPES.join(', ')}`);
  console.log(`expires_at:   ${expiresAt.toISOString()}`);
  console.log('==========================\n');
  console.log('Verify:');
  console.log(`  curl https://ship-api-ysxi.onrender.com/api/v1/docs -H "Authorization: Bearer ${token}"`);
}

seed()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
