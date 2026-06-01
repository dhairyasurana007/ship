import { Router } from 'express';
import { bearerAuth } from '../../middleware/bearerAuth.js';
import { requestId } from '../../middleware/requestId.js';
import { platformErrorHandler } from '../../middleware/errorHandler.js';
import { generateOpenApiSpec } from '../../openapi/generator.js';
import documentsRouter from './routes/documents.js';
import meRouter from './routes/me.js';
import appsRouter from '../../../platform/apps/appsRouter.js';

const v1Router = Router();

v1Router.use(requestId);

// OpenAPI spec — no auth
v1Router.get('/openapi.json', (_req, res) => {
  res.json(generateOpenApiSpec());
});

// Health
v1Router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Apps registration — no bearer auth required (pre-auth)
v1Router.use('/apps', appsRouter);

// All routes below require bearer auth
v1Router.use(bearerAuth);

v1Router.use('/docs', documentsRouter);
v1Router.use('/me', meRouter);

v1Router.use(platformErrorHandler);

export { v1Router };
