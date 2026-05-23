import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'crypto';
import { pool } from '../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { cleanupExpiredProbeElevations } from '../services/internal-probe.js';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

const DEFAULT_TTL_MINUTES = 10;
const MAX_TTL_MINUTES = 30;
const PROBE_EMAIL_PATTERN = /^probe-[a-z0-9._%+-]+@probe\.local$/i;

function toBuffer(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function safeTokenEquals(received: string, expected: string): boolean {
  const left = toBuffer(received);
  const right = toBuffer(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isAllowedIp(ip: string, allowlist: string[]): boolean {
  return allowlist.some(candidate => candidate.trim() === ip);
}

function authorizeInternalProbe(req: Request, res: Response): { callerIp: string } | null {
  if (process.env.PROBE_INTERNAL_ELEVATION_ENABLED !== 'true') {
    res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Not found',
      },
    });
    return null;
  }

  const configuredToken = process.env.PROBE_INTERNAL_ELEVATION_TOKEN;
  if (!configuredToken) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal probe endpoint is misconfigured',
      },
    });
    return null;
  }

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer || !safeTokenEquals(bearer, configuredToken)) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
      },
    });
    return null;
  }

  const allowlistRaw = process.env.PROBE_INTERNAL_ELEVATION_IP_ALLOWLIST?.trim();
  const callerIp = getClientIp(req);
  if (allowlistRaw) {
    const allowlist = allowlistRaw.split(',').map(x => x.trim()).filter(Boolean);
    if (!isAllowedIp(callerIp, allowlist)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Forbidden',
        },
      });
      return null;
    }
  }
  return { callerIp };
}

router.post('/elevate-admin', async (req: Request, res: Response): Promise<void> => {
  const auth = authorizeInternalProbe(req, res);
  if (!auth) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const rawTtl = req.body?.ttlMinutes;
  const ttlMinutes = typeof rawTtl === 'number' ? rawTtl : DEFAULT_TTL_MINUTES;

  if (!email || !PROBE_EMAIL_PATTERN.test(email)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email must match probe account pattern',
      },
    });
    return;
  }

  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > MAX_TTL_MINUTES) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `ttlMinutes must be > 0 and <= ${MAX_TTL_MINUTES}`,
      },
    });
    return;
  }

  try {
    await cleanupExpiredProbeElevations();

    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    const user = userResult.rows[0];

    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await pool.query(
      `INSERT INTO internal_probe_admin_elevations (user_id, elevated_by, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET elevated_by = EXCLUDED.elevated_by, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
      [user.id, 'security-probe', expiresAt]
    );

    await logAuditEvent({
      actorUserId: user.id,
      action: 'internal.probe.elevate_admin',
      resourceType: 'user',
      resourceId: user.id,
      details: { email: user.email, ttlMinutes, expiresAt: expiresAt.toISOString(), callerIp: auth.callerIp },
      req,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        email: user.email,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Internal probe elevate admin error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to elevate probe user',
      },
    });
  }
});

router.post('/cleanup-test-users', async (req: Request, res: Response): Promise<void> => {
  const auth = authorizeInternalProbe(req, res);
  if (!auth) return;

  const emailPrefixes = ['probe-test-', 'probe-input-bootstrap-', 'probe-ws-bootstrap-', 'probe-ws-'];
  const emailLikes = emailPrefixes.map((p) => `${p}%`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const candidates = await client.query(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) LIKE ANY($1::text[])
       ORDER BY email`,
      [emailLikes.map((v) => v.toLowerCase())]
    );
    const matchedBefore = candidates.rows.map((row) => ({
      id: row.id as string,
      email: row.email as string
    }));

    const deleted: Array<{ id: string; email: string }> = [];
    for (const row of candidates.rows) {
      const userId = row.id as string;
      const email = row.email as string;
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM workspace_memberships WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      deleted.push({ id: userId, email });
    }

    const remaining = await client.query(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) LIKE ANY($1::text[])
       ORDER BY email`,
      [emailLikes.map((v) => v.toLowerCase())]
    );

    await client.query('COMMIT');

    await logAuditEvent({
      actorUserId: undefined,
      action: 'internal.probe.cleanup_test_users',
      resourceType: 'user',
      resourceId: undefined,
      details: {
        emailPrefixes,
        matchedBeforeCount: matchedBefore.length,
        matchedBeforeEmails: matchedBefore.map((x) => x.email),
        deletedCount: deleted.length,
        deletedEmails: deleted.map((x) => x.email),
        remainingCount: remaining.rows.length,
        remainingEmails: remaining.rows.map((x) => x.email as string),
        callerIp: auth.callerIp
      },
      req
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        emailPrefixes,
        matchedBeforeCount: matchedBefore.length,
        matchedBefore: matchedBefore,
        deletedCount: deleted.length,
        deleted,
        remainingCount: remaining.rows.length,
        remaining: remaining.rows
      }
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('Internal probe cleanup test users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to cleanup probe test users',
      },
    });
  } finally {
    client.release();
  }
});

export default router;
