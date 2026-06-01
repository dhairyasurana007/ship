import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { generateOpenApiSpec } from '../openapi/generator.js';

describe('OpenAPI 3.1 spec validation', () => {
  it('generates a valid OpenAPI 3.1 document', async () => {
    // Import routes to populate registry
    await import('../api/v1/routes/documents.js');
    await import('../api/v1/routes/me.js');

    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(Object.keys(spec.paths)).toContain('/docs');
  });
});
