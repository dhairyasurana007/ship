import { ShipError } from '../errors.js';

export interface Sprint {
  id: string;
  title: string;
  document_type: string;
  created_at: string;
}

export interface SprintsListResult {
  data: Sprint[];
  next_cursor: string | null;
}

export class SprintsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async list(cursor?: string): Promise<SprintsListResult> {
    const url = new URL('/api/v1/docs', this.baseUrl);
    url.searchParams.set('document_type', 'sprint');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body as SprintsListResult;
  }
}
