import { Router } from 'express';
import { ApiError } from '../../../errors/ApiError.js';
import { registerRoute } from '../../../openapi/registerRoute.js';
import { pool } from '../../../../db/client.js';

const router = Router();

registerRoute(router, 'get', '/me', {
  operationId: 'getMe',
  summary: 'Get current authenticated user',
}, async (req, res, next) => {
  try {
    if (!req.auth?.userId || req.auth.isMachine) {
      throw new ApiError('forbidden', 'Client Credentials tokens cannot access /me');
    }
    const result = await pool.query(
      `SELECT id, name, email FROM users WHERE id = $1`,
      [req.auth.userId]
    );
    if (result.rows.length === 0) throw new ApiError('not_found', 'User not found');
    res.json({ ...result.rows[0], granted_scopes: req.auth.scopes });
  } catch (err) { next(err); }
});

export default router;
