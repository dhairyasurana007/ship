import { ShipError } from '../errors.js';
import type { Document } from '../types.js';

export interface DocumentsListResult {
  data: Document[];
  next_cursor: string | null;
}

export interface CreateDocumentInput {
  title: string;
  document_type?: string;
  content?: unknown;
  properties?: Record<string, unknown>;
}

export class DocumentsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get authHeaders() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async list(cursor?: string): Promise<DocumentsListResult> {
    const url = new URL('/api/v1/docs', this.baseUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: this.authHeaders });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body as DocumentsListResult;
  }

  async get(id: string): Promise<Document> {
    const response = await fetch(new URL(`/api/v1/docs/${id}`, this.baseUrl), { headers: this.authHeaders });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body as Document;
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    const response = await fetch(new URL('/api/v1/docs', this.baseUrl), {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(input),
    });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body as Document;
  }

  async *iterate(): AsyncGenerator<Document> {
    let cursor: string | undefined;
    do {
      const result = await this.list(cursor);
      yield* result.data;
      cursor = result.next_cursor ?? undefined;
    } while (cursor);
  }
}
