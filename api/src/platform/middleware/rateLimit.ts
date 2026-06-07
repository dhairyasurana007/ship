import type { Request, Response, NextFunction } from 'express';
import { rateLimiter } from '../ratelimit/TokenBucketLimiter.js';

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = (req as unknown as { auth?: { appId?: string } }).auth?.appId ?? req.ip ?? 'anonymous';
  const result = rateLimiter.check(key);

  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    res.setHeader('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000));
    res.status(429).json({
      code: 'rate_limited',
      message: 'Too many requests',
      request_id: res.locals['requestId'],
    });
    return;
  }

  next();
}
