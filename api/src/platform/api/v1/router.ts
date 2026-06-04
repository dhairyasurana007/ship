import { Router } from 'express';
import { bearerAuth } from '../../middleware/bearerAuth.js';
import { requestId } from '../../middleware/requestId.js';
import { platformErrorHandler } from '../../middleware/errorHandler.js';
import { generateOpenApiSpec } from '../../openapi/generator.js';
import documentsRouter from './routes/documents.js';
import meRouter from './routes/me.js';
import appsRouter from '../../../platform/apps/appsRouter.js';
import webhooksRouter from '../../webhooks/webhooksRouter.js';
import deliveriesRouter from '../../webhooks/deliveriesRouter.js';
import { eventBus } from '../../events/InMemoryEventBus.js';
import { webhookDeliverer } from '../../webhooks/InMemoryWebhookDeliverer.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { auditLog } from '../../audit/auditLog.js';

// Wire event delivery once at module load
eventBus.subscribe(webhookDeliverer.deliver.bind(webhookDeliverer));

const v1Router = Router();

v1Router.use(requestId);

// OpenAPI spec — no auth
v1Router.get('/openapi.json', (_req, res) => {
  res.json(generateOpenApiSpec());
});

// Health — no auth
v1Router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Apps registration — no bearer auth required
v1Router.use('/apps', appsRouter);

// Audit + rate-limit run on every request (before auth so 401/403 are covered too)
v1Router.use(auditLog);
v1Router.use(rateLimit);

// All routes below require bearer auth
v1Router.use(bearerAuth);

// Mount at root so registerRoute paths (/docs, /docs/:id, /me, /webhooks) are full paths
v1Router.use(documentsRouter);
v1Router.use(meRouter);
v1Router.use(webhooksRouter);
v1Router.use(deliveriesRouter);

v1Router.use(platformErrorHandler);

export { v1Router };
