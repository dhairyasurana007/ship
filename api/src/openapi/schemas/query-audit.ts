import { z } from 'zod';
import { registry } from '../registry.js';

const QueryRecordSchema = registry.register(
  'QueryAuditRecord',
  z.object({
    durationMs: z.number(),
    text: z.string(),
  })
);

const RequestSnapshotSchema = registry.register(
  'QueryAuditRequestSnapshot',
  z.object({
    requestId: z.string(),
    method: z.string(),
    path: z.string(),
    requestDurationMs: z.number(),
    totalQueries: z.number(),
    slowestQueryMs: z.number(),
    duplicateQueryCount: z.number(),
    queries: z.array(QueryRecordSchema),
    capturedAt: z.string(),
  })
);

const QueryAuditSnapshotResponseSchema = registry.register(
  'QueryAuditSnapshotResponse',
  z.object({
    success: z.literal(true),
    enabled: z.boolean(),
    totalRequestsCaptured: z.number(),
    latestRequest: RequestSnapshotSchema.nullable(),
    recentRequests: z.array(RequestSnapshotSchema),
  })
);

const QueryAuditResetResponseSchema = registry.register(
  'QueryAuditResetResponse',
  z.object({
    success: z.literal(true),
    reset: z.literal(true),
  })
);

registry.registerPath({
  method: 'get',
  path: '/api/debug/query-audit/snapshot',
  summary: 'Get query-audit snapshot',
  description: 'Returns recent per-request SQL query instrumentation snapshots when query-audit debug mode is enabled.',
  tags: ['Debug'],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  responses: {
    200: {
      description: 'Snapshot retrieved',
      content: {
        'application/json': {
          schema: QueryAuditSnapshotResponseSchema,
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden (super-admin required)' },
    404: { description: 'Debug endpoint disabled' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/debug/query-audit/reset',
  summary: 'Reset query-audit snapshots',
  description: 'Clears in-memory query-audit snapshots when query-audit debug mode is enabled.',
  tags: ['Debug'],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  responses: {
    200: {
      description: 'Snapshots reset',
      content: {
        'application/json': {
          schema: QueryAuditResetResponseSchema,
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden (super-admin required)' },
    404: { description: 'Debug endpoint disabled' },
  },
});

