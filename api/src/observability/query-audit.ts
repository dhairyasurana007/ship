import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';

interface QueryRecord {
  durationMs: number;
  text: string;
}

interface RequestAuditContext {
  requestId: string;
  method: string;
  path: string;
  startedAtMs: number;
  queries: QueryRecord[];
}

interface RequestAuditSnapshot {
  requestId: string;
  method: string;
  path: string;
  requestDurationMs: number;
  totalQueries: number;
  slowestQueryMs: number;
  duplicateQueryCount: number;
  queries: QueryRecord[];
  capturedAt: string;
}

interface QueryAuditSnapshotResponse {
  enabled: boolean;
  totalRequestsCaptured: number;
  latestRequest: RequestAuditSnapshot | null;
  recentRequests: RequestAuditSnapshot[];
}

const MAX_STORED_REQUESTS = 200;
const QUERY_TEXT_MAX = 200;
const storage = new AsyncLocalStorage<RequestAuditContext>();

let isInitialized = false;
let nextRequestId = 1;
let latestRequest: RequestAuditSnapshot | null = null;
const recentRequests: RequestAuditSnapshot[] = [];

function sanitizeQueryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, QUERY_TEXT_MAX);
}

function duplicateQueryCount(queries: QueryRecord[]): number {
  const counts = new Map<string, number>();
  for (const q of queries) {
    const key = q.text;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return duplicates;
}

function finalizeContext(ctx: RequestAuditContext): void {
  const requestDurationMs = performance.now() - ctx.startedAtMs;
  const slowestQueryMs = ctx.queries.reduce((max, q) => Math.max(max, q.durationMs), 0);
  const snapshot: RequestAuditSnapshot = {
    requestId: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
    requestDurationMs: Number(requestDurationMs.toFixed(3)),
    totalQueries: ctx.queries.length,
    slowestQueryMs: Number(slowestQueryMs.toFixed(3)),
    duplicateQueryCount: duplicateQueryCount(ctx.queries),
    queries: ctx.queries,
    capturedAt: new Date().toISOString(),
  };
  latestRequest = snapshot;
  recentRequests.push(snapshot);
  if (recentRequests.length > MAX_STORED_REQUESTS) {
    recentRequests.splice(0, recentRequests.length - MAX_STORED_REQUESTS);
  }
}

function recordQuery(text: string, durationMs: number): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.queries.push({
    text: sanitizeQueryText(text),
    durationMs: Number(durationMs.toFixed(3)),
  });
}

function instrumentPool(): void {
  if (isInitialized) return;
  isInitialized = true;

  const originalPoolQuery = pool.query.bind(pool) as (...args: any[]) => Promise<any>;
  pool.query = (async (...args: any[]) => {
    const textArg = args[0];
    const queryText = typeof textArg === 'string' ? textArg : textArg && typeof textArg === 'object' && 'text' in textArg ? String((textArg as { text: string }).text) : 'unknown';
    const startedAtMs = performance.now();
    try {
      return await originalPoolQuery(...args);
    } finally {
      recordQuery(queryText, performance.now() - startedAtMs);
    }
  }) as unknown as typeof pool.query;

  // Capture query calls made via pool.connect() clients as well.
  pool.on('connect', (client: PoolClient) => {
    instrumentClientQuery(client);
  });
}

function instrumentClientQuery(client: PoolClient): void {
  const instrumented = client as PoolClient & { __queryAuditInstrumented?: boolean };
  if (instrumented.__queryAuditInstrumented) return;
  instrumented.__queryAuditInstrumented = true;

  const originalClientQuery = client.query.bind(client) as (...args: any[]) => Promise<any>;
  client.query = (async (...args: any[]) => {
    const textArg = args[0];
    const queryText = typeof textArg === 'string' ? textArg : textArg && typeof textArg === 'object' && 'text' in textArg ? String((textArg as { text: string }).text) : 'unknown';
    const startedAtMs = performance.now();
    try {
      return await originalClientQuery(...args);
    } finally {
      recordQuery(queryText, performance.now() - startedAtMs);
    }
  }) as unknown as PoolClient['query'];
}

export function isQueryAuditEnabled(): boolean {
  return process.env.ENABLE_QUERY_AUDIT_DEBUG === 'true';
}

export function initializeQueryAudit(): void {
  if (!isQueryAuditEnabled()) return;
  instrumentPool();
}

export function queryAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isQueryAuditEnabled()) {
    next();
    return;
  }

  const ctx: RequestAuditContext = {
    requestId: String(nextRequestId++),
    method: req.method,
    path: req.originalUrl || req.path,
    startedAtMs: performance.now(),
    queries: [],
  };

  storage.run(ctx, () => {
    let finalized = false;
    const finalizeOnce = () => {
      if (finalized) return;
      finalized = true;
      finalizeContext(ctx);
    };
    res.on('finish', finalizeOnce);
    res.on('close', finalizeOnce);
    next();
  });
}

export function resetQueryAuditSnapshots(): void {
  latestRequest = null;
  recentRequests.length = 0;
}

export function getQueryAuditSnapshot(): QueryAuditSnapshotResponse {
  return {
    enabled: isQueryAuditEnabled(),
    totalRequestsCaptured: recentRequests.length,
    latestRequest,
    recentRequests: recentRequests.slice(-25),
  };
}
