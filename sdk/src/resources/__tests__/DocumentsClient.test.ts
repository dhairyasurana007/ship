import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentsClient } from '../DocumentsClient.js';

describe('DocumentsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches a document by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'doc-1',
        title: 'Doc',
        document_type: 'wiki',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = new DocumentsClient('https://ship.test', 'token-123');
    const doc = await client.get('doc-1');

    expect(doc.id).toBe('doc-1');
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/api/v1/docs/doc-1', 'https://ship.test'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });
});
