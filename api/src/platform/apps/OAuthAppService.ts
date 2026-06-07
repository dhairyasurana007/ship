import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../../db/client.js';

export interface OAuthApp {
  id: string;
  client_id: string;
  name: string;
  redirect_uris: string[];
  owner_id: string | null;
  requested_scopes: string[];
  created_at: string;
}

export interface CreateAppInput {
  name: string;
  redirect_uris: string[];
  scopes: string[];
  owner_id?: string | null;
}

export class OAuthAppService {
  async createApp(input: CreateAppInput): Promise<OAuthApp & { client_secret: string }> {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hashed = await bcrypt.hash(rawSecret, 12);
    const result = await pool.query<any>(
      `INSERT INTO oauth_apps (hashed_client_secret, name, redirect_uris, owner_id, requested_scopes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, client_id, name, redirect_uris, owner_id, requested_scopes, created_at`,
      [hashed, input.name, input.redirect_uris, input.owner_id ?? null, input.scopes]
    );
    return { ...result.rows[0], client_secret: rawSecret };
  }

  async rotateSecret(appId: string): Promise<{ client_secret: string }> {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hashed = await bcrypt.hash(rawSecret, 12);
    const result = await pool.query(
      `UPDATE oauth_apps SET hashed_client_secret = $1 WHERE id = $2 RETURNING id`,
      [hashed, appId]
    );
    if (result.rowCount === 0) throw new Error('App not found');
    return { client_secret: rawSecret };
  }

  async getAppByClientId(clientId: string): Promise<OAuthApp | null> {
    const result = await pool.query<any>(
      `SELECT id, client_id, name, redirect_uris, owner_id, requested_scopes, created_at
       FROM oauth_apps WHERE client_id = $1`,
      [clientId]
    );
    return result.rows[0] ?? null;
  }

  async getAppByName(name: string): Promise<OAuthApp | null> {
    const result = await pool.query<any>(
      `SELECT id, client_id, name, redirect_uris, owner_id, requested_scopes, created_at
       FROM oauth_apps WHERE name = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [name]
    );
    return result.rows[0] ?? null;
  }

  async getAppById(appId: string): Promise<OAuthApp | null> {
    const result = await pool.query<any>(
      `SELECT id, client_id, name, redirect_uris, owner_id, requested_scopes, created_at
       FROM oauth_apps WHERE id = $1`,
      [appId]
    );
    return result.rows[0] ?? null;
  }
}

export const oAuthAppService = new OAuthAppService();
