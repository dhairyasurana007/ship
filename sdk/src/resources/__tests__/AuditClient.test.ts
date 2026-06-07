import { describe, it, expect, vi } from 'vitest';
import { AuditClient } from '../AuditClient.js';

describe('AuditClient', () => {
  it('lists audit trail entries with cursor pagination', async () => {
    const fetchMock = vi.fn(async (input: Request | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/v1/audit');
      expect(url.searchParams.get('cursor')).toBe('cursor-1');
      return new Response(JSON.stringify({
        data: [
          {
            client_id: 'client-1',
            user_id: 'user-1',
            route: '/api/v1/docs',
            scope_used: 'documents:read',
            http_status: 200,
            latency_ms: 12,
            request_id: 'req-1',
            created_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const client = new AuditClient('https://ship.example.gov', 'token-123');
      const result = await client.list('cursor-1');
      expect(result.data[0]?.route).toBe('/api/v1/docs');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
