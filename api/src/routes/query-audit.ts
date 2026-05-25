import { Router, Request, Response } from 'express';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import {
  getQueryAuditSnapshot,
  isQueryAuditEnabled,
  resetQueryAuditSnapshots,
} from '../observability/query-audit.js';

const router = Router();

function rejectIfDisabled(res: Response): boolean {
  if (isQueryAuditEnabled()) return false;
  res.status(404).json({
    success: false,
    error: 'Query audit debug endpoints are disabled',
  });
  return true;
}

// POST /api/debug/query-audit/reset
router.post('/query-audit/reset', authMiddleware, superAdminMiddleware, (_req: Request, res: Response) => {
  if (rejectIfDisabled(res)) return;
  resetQueryAuditSnapshots();
  res.json({
    success: true,
    reset: true,
  });
});

// GET /api/debug/query-audit/snapshot
router.get('/query-audit/snapshot', authMiddleware, superAdminMiddleware, (_req: Request, res: Response) => {
  if (rejectIfDisabled(res)) return;
  res.json({
    success: true,
    ...getQueryAuditSnapshot(),
  });
});

export default router;
