import { describe, it, expect } from 'vitest';
import { generateOpenApiSpec } from '../openapi/generator.js';
import { ShipClient } from '../../../../sdk/src/ShipClient.js';

describe('OpenAPI parity with SDK surface', () => {
  it('exposes a typed SDK method for every public API operation', async () => {
    await import('../api/v1/routes/documents.js');
    await import('../api/v1/routes/me.js');
    await import('../webhooks/webhooksRouter.js');
    await import('../webhooks/deliveriesRouter.js');

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
      'get /docs',
      'get /docs/:id',
      'post /docs',
      'get /me',
      'post /webhooks',
      'get /webhooks',
      'get /webhooks/deliveries',
      'post /webhooks/deliveries/:id/replay',
    ]);

    const actual = new Set(
      Object.entries(spec.paths).flatMap(([rawPath, pathItem]) =>
        Object.keys(pathItem).map((method) => `${method} ${rawPath.replace(/\{([^}]+)\}/g, ':$1')}`),
      ),
    );

    for (const route of expected) {
      expect(actual.has(route), `Expected OpenAPI route ${route} to exist`).toBe(true);
    }
  });
});
