import { ShipError } from "../errors.js";

export interface AuditTrailEntry {
  client_id: string | null;
  user_id: string | null;
  route: string;
  scope_used: string | null;
  http_status: number;
  latency_ms: number | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditTrailListResult {
  data: AuditTrailEntry[];
  next_cursor: string | null;
}

export class AuditClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async list(cursor?: string): Promise<AuditTrailListResult> {
    const url = new URL("/api/v1/audit", this.baseUrl);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    const body = (await response.json()) as any;
    if (!response.ok) {
      throw ShipError.fromResponse(
        body.code,
        body.message,
        body.details,
        body.request_id,
      );
    }

    return body as AuditTrailListResult;
  }
}
