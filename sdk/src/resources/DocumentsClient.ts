import { ShipError } from '../errors.js';
import type { Document } from '../types.js';

export interface DocumentsListResult {
  data: Document[];
  next_cursor: string | null;
}

export class DocumentsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async list(cursor?: string): Promise<DocumentsListResult> {
    const url = new URL('/api/v1/docs', this.baseUrl);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    const body = await response.json() as any;
    if (!response.ok) {
      throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    }

    return body as DocumentsListResult;
  }
}
