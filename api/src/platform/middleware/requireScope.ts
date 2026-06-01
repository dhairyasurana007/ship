import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';

export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth?.scopes.includes(scope)) {
      return next(
        new ApiError('forbidden', 'Insufficient scope', { required: scope })
      );
    }
    next();
  };
}
