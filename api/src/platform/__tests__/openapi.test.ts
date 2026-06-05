import { describe, it, expect } from 'vitest';
import { generateOpenApiSpec } from '../openapi/generator.js';

describe('OpenAPI 3.1 spec validation', () => {
  it('generates a valid OpenAPI 3.1 document with all expected paths', async () => {
    await import('../api/v1/routes/documents.js');
    await import('../api/v1/routes/me.js');

    const spec = generateOpenApiSpec();

    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(Object.keys(spec.paths)).toContain('/docs');
    expect(Object.keys(spec.paths)).toContain('/docs/{id}');
    expect(Object.keys(spec.paths)).toContain('/me');
  });

  it('validates required top-level fields (OpenAPI 3.1 structural contract)', async () => {
    const spec = generateOpenApiSpec();

    // Required by OpenAPI 3.1 spec
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');
  });

  it('every path operation has an operationId', async () => {
    await import('../api/v1/routes/documents.js');
    await import('../api/v1/routes/me.js');

    const spec = generateOpenApiSpec();
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of methods) {
        const op = (pathItem as Record<string, any>)[method];
        if (!op) continue;
        expect(
          op.operationId,
          `${method.toUpperCase()} ${path} is missing operationId`
        ).toBeTruthy();
      }
    }
  });

  it('every operation with a security requirement references a defined scheme', async () => {
    const spec = generateOpenApiSpec();
    const definedSchemes = Object.keys(spec.components?.securitySchemes ?? {});
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of methods) {
        const op = (pathItem as Record<string, any>)[method];
        if (!op?.security) continue;
        for (const requirement of op.security as Record<string, string[]>[]) {
          for (const schemeName of Object.keys(requirement)) {
            expect(
              definedSchemes,
              `${method.toUpperCase()} ${path} references undefined security scheme '${schemeName}'`
            ).toContain(schemeName);
          }
        }
      }
    }
  });

  it('no drift: openapi version is exactly 3.1.0', () => {
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
  });
});
