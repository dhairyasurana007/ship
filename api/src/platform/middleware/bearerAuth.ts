import { Request, Response, NextFunction } from 'express';
import { pool } from '../../db/client.js';
import { ApiError } from '../errors/ApiError.js';

export interface AuthContext {
  appId: string;
  userId: string | null;
  scopes: string[];
  isMachine: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function bearerAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new ApiError('unauthorized', 'Missing or invalid Authorization header'));
  }
  const token = header.slice(7);
  try {
    const result = await pool.query(
      `SELECT id, app_id, user_id, scopes, expires_at, revoked_at, token_kind
       FROM oauth_access_tokens WHERE token = $1`,
      [token]
    );
    if (result.rows.length === 0) {
      return next(new ApiError('unauthorized', 'Invalid token'));
    }
    const row = result.rows[0];
    if (row.revoked_at) {
      return next(new ApiError('unauthorized', 'Token has been revoked'));
    }
    if (new Date(row.expires_at) < new Date()) {
      return next(new ApiError('token_expired', 'Token has expired'));
    }
    req.auth = {
      appId: row.app_id,
      userId: row.user_id,
      scopes: row.scopes,
      isMachine: row.token_kind === 'machine',
    };
    next();
  } catch (err) {
    const error = err as { code?: string; column?: string };
    if (error.code === '42703' && error.column === 'token_kind') {
      const fallbackResult = await pool.query(
        `SELECT id, app_id, user_id, scopes, expires_at, revoked_at
         FROM oauth_access_tokens WHERE token = $1`,
        [token]
      );
      if (fallbackResult.rows.length === 0) {
        return next(new ApiError('unauthorized', 'Invalid token'));
      }
      const row = fallbackResult.rows[0];
      if (row.revoked_at) {
        return next(new ApiError('unauthorized', 'Token has been revoked'));
      }
      if (new Date(row.expires_at) < new Date()) {
        return next(new ApiError('token_expired', 'Token has expired'));
      }
      req.auth = {
        appId: row.app_id,
        userId: row.user_id,
        scopes: row.scopes,
        isMachine: false,
      };
      next();
      return;
    }
    next(err);
  }
}
