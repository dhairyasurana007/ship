import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function requestId(req: Request, res: Response, next: NextFunction) {
  res.locals.requestId = crypto.randomUUID();
  next();
}
