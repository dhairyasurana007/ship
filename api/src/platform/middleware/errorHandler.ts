import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';

export function platformErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = res.locals.requestId as string | undefined;

  if (err instanceof ApiError) {
    const status =
      err.code === 'unauthorized' ? 401
      : err.code === 'forbidden' ? 403
      : err.code === 'not_found' ? 404
      : err.code === 'validation_failed' ? 400
      : err.code === 'rate_limited' ? 429
      : 500;

    res.status(status).json({
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
      request_id: requestId,
    });
    return;
  }

  console.error('Unhandled platform error:', err);
  res.status(500).json({
    code: 'server_error',
    message: 'Internal server error',
    request_id: requestId,
  });
}
