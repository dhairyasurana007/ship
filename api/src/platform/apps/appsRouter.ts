import { Router } from 'express';
import { z } from 'zod';
import { oAuthAppService } from './OAuthAppService.js';
import { ApiError } from '../errors/ApiError.js';

const router = Router();

const createAppSchema = z.object({
  name: z.string().min(1).max(255),
  redirect_uris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string()).optional().default([]),
});

// POST /api/v1/apps — create OAuth app, returns secret once
router.post('/', async (req, res, next) => {
  try {
    const body = createAppSchema.safeParse(req.body);
    if (!body.success) {
      throw new ApiError('validation_failed', 'Invalid request body', body.error.flatten());
    }
    const app = await oAuthAppService.createApp({
      name: body.data.name,
      redirect_uris: body.data.redirect_uris,
      scopes: body.data.scopes,
    });
    res.status(201).json(app);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/apps/:id — fetch app, no secret
router.get('/:id', async (req, res, next) => {
  try {
    const app = await oAuthAppService.getAppById(req.params.id);
    if (!app) throw new ApiError('not_found', 'App not found');
    res.json(app);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/apps/:id/rotate — rotate secret, returns new secret once
router.post('/:id/rotate', async (req, res, next) => {
  try {
    const result = await oAuthAppService.rotateSecret(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
