import { pool } from '../db/client.js';

export async function cleanupExpiredProbeElevations(): Promise<void> {
  await pool.query(
    'DELETE FROM internal_probe_admin_elevations WHERE expires_at <= NOW()'
  );
}

export async function isProbeElevatedUser(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM internal_probe_admin_elevations
     WHERE user_id = $1 AND expires_at > NOW()`,
    [userId]
  );
  return !!result.rows[0];
}
