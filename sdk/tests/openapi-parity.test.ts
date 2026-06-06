import { describe, it, expect } from 'vitest';
import { ShipClient } from '../src/ShipClient.js';

describe('OpenAPI parity with SDK surface', () => {
  it('exposes a typed SDK method for every public API operation', async () => {
    const { generateOpenApiSpec } = await import('../../api/src/platform/openapi/generator.js');
    await import('../../api/src/platform/api/v1/router.js');

    const spec = generateOpenApiSpec();
    const client = new ShipClient({ token: 'test-token', baseUrl: 'https://ship.example.gov' });

    expect(typeof client.me).toBe('function');
    expect(typeof client.documents.list).toBe('function');
    expect(typeof client.documents.get).toBe('function');
    expect(typeof client.documents.create).toBe('function');
    expect(typeof client.documents.iterate).toBe('function');
    expect(typeof client.issues.list).toBe('function');
    expect(typeof client.sprints.list).toBe('function');
    expect(typeof client.webhooks.create).toBe('function');
    expect(typeof client.webhooks.list).toBe('function');
    expect(typeof client.webhooks.deliveries).toBe('function');
    expect(typeof client.webhooks.replay).toBe('function');

    const expected = new Set([
      '/openapi.json',
      '/health',
      '/apps',
      '/apps/{id}',
      '/apps/{id}/rotate',
      '/docs',
      '/docs/{id}',
      '/me',
      '/webhooks',
      '/webhooks/deliveries',
      '/webhooks/deliveries/{id}/replay',
    ]);

    for (const path of expected) {
      expect(spec.paths[path], `Expected OpenAPI path ${path} to exist`).toBeDefined();
    }
  });
});
