import { pool } from '../../db/client.js';

export interface DeviceCodeEntry {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scope: string;
  expiresAt: Date;
  approved: boolean;
  userId: string | null;
  lastPolledAt: Date | null;
}

const normalizeUserCode = (userCode: string): string =>
  userCode.toUpperCase().replace(/[^A-Z]/g, '').replace(/(.{4})(.{4})/, '$1-$2');

const cleanupExpired = async (): Promise<void> => {
  await pool.query('DELETE FROM oauth_device_codes WHERE expires_at < NOW()');
};

export const deviceStore = {
  async set(deviceCode: string, entry: DeviceCodeEntry): Promise<void> {
    await pool.query(
      `INSERT INTO oauth_device_codes
         (device_code, user_code, client_id, scope, expires_at, approved, user_id, last_polled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (device_code) DO UPDATE SET
         user_code = EXCLUDED.user_code,
         client_id = EXCLUDED.client_id,
         scope = EXCLUDED.scope,
         expires_at = EXCLUDED.expires_at,
         approved = EXCLUDED.approved,
         user_id = EXCLUDED.user_id,
         last_polled_at = EXCLUDED.last_polled_at,
         updated_at = NOW()`,
      [
        deviceCode,
        entry.userCode,
        entry.clientId,
        entry.scope,
        entry.expiresAt,
        entry.approved,
        entry.userId,
        entry.lastPolledAt,
      ],
    );
  },

  async getByDeviceCode(deviceCode: string): Promise<DeviceCodeEntry | undefined> {
    await cleanupExpired();
    const result = await pool.query(
      `SELECT device_code, user_code, client_id::text AS client_id, scope, expires_at, approved, user_id::text AS user_id, last_polled_at
       FROM oauth_device_codes
       WHERE device_code = $1`,
      [deviceCode],
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0] as Record<string, unknown>;
    return {
      deviceCode: row.device_code as string,
      userCode: row.user_code as string,
      clientId: row.client_id as string,
      scope: row.scope as string,
      expiresAt: new Date(row.expires_at as string),
      approved: row.approved as boolean,
      userId: (row.user_id as string | null) ?? null,
      lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at as string) : null,
    };
  },

  async getByUserCode(userCode: string): Promise<DeviceCodeEntry | undefined> {
    await cleanupExpired();
    const normalized = normalizeUserCode(userCode);
    const result = await pool.query(
      `SELECT device_code, user_code, client_id::text AS client_id, scope, expires_at, approved, user_id::text AS user_id, last_polled_at
       FROM oauth_device_codes
       WHERE user_code = $1`,
      [normalized],
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0] as Record<string, unknown>;
    return {
      deviceCode: row.device_code as string,
      userCode: row.user_code as string,
      clientId: row.client_id as string,
      scope: row.scope as string,
      expiresAt: new Date(row.expires_at as string),
      approved: row.approved as boolean,
      userId: (row.user_id as string | null) ?? null,
      lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at as string) : null,
    };
  },

  async approve(deviceCode: string, userId: string): Promise<void> {
    await pool.query(
      `UPDATE oauth_device_codes
       SET approved = TRUE, user_id = $2, updated_at = NOW()
       WHERE device_code = $1`,
      [deviceCode, userId],
    );
  },

  async updateLastPolled(deviceCode: string): Promise<void> {
    await pool.query(
      `UPDATE oauth_device_codes
       SET last_polled_at = NOW(), updated_at = NOW()
       WHERE device_code = $1`,
      [deviceCode],
    );
  },

  async delete(deviceCode: string): Promise<void> {
    await pool.query('DELETE FROM oauth_device_codes WHERE device_code = $1', [deviceCode]);
  },
};
