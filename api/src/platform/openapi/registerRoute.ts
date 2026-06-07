import { Router, RequestHandler } from 'express';
import { ZodType } from 'zod';

export interface RouteMetadata {
  operationId: string;
  summary: string;
  scope?: string;
  requestSchema?: ZodType;
  responseSchema?: ZodType;
}

const registry = new Map<string, RouteMetadata>();

export function registerRoute(
  router: Router,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  meta: RouteMetadata,
  ...handlers: RequestHandler[]
) {
  registry.set(`${method.toUpperCase()} ${path}`, meta);
  (router as any)[method](path, ...handlers);
}

export function getRegistry(): Map<string, RouteMetadata> {
  return registry;
}
