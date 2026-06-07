import type { Request, Response, NextFunction } from 'express';
import { pool } from '../../db/client.js';

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const auth = (req as unknown as { auth?: { appId?: string; userId?: string; scopes?: string[] } }).auth;
    const latencyMs = Date.now() - start;
    const route = req.route?.path ?? req.path;

    pool.query(
      `INSERT INTO public_api_audit
         (client_id, user_id, route, scope_used, http_status, latency_ms, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auth?.appId ?? null,
        auth?.userId ?? null,
        route,
        auth?.scopes?.join(',') ?? null,
        res.statusCode,
        latencyMs,
        res.locals['requestId'] ?? null,
      ]
    ).catch(() => { /* fire-and-forget */ });
  });

  next();
}
