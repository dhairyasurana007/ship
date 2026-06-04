import { ShipError } from '../errors.js';

export interface WebhookSubscription {
  id: string;
  target_url: string;
  event_types: string[];
  enabled: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  attempt_number: number;
  response_status: number | null;
  latency_ms: number | null;
  idempotency_key: string;
  dead_lettered_at: string | null;
  created_at: string;
}

export class WebhooksClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private get headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async create(targetUrl: string, eventTypes: string[] = []): Promise<WebhookSubscription & { signing_secret: string }> {
    const response = await fetch(new URL('/api/v1/webhooks', this.baseUrl), {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ target_url: targetUrl, event_types: eventTypes }),
    });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body;
  }

  async list(): Promise<{ data: WebhookSubscription[] }> {
    const response = await fetch(new URL('/api/v1/webhooks', this.baseUrl), { headers: this.headers });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body;
  }

  async deliveries(cursor?: string): Promise<{ data: WebhookDelivery[]; next_cursor: string | null }> {
    const url = new URL('/api/v1/webhooks/deliveries', this.baseUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: this.headers });
    const body = await response.json() as any;
    if (!response.ok) throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    return body;
  }

  async replay(deliveryId: string): Promise<void> {
    const response = await fetch(new URL(`/api/v1/webhooks/deliveries/${deliveryId}/replay`, this.baseUrl), {
      method: 'POST', headers: this.headers,
    });
    if (!response.ok) {
      const body = await response.json() as any;
      throw ShipError.fromResponse(body.code, body.message, body.details, body.request_id);
    }
  }
}
