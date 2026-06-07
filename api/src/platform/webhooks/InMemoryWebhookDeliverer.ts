import crypto from 'crypto';
import { pool } from '../../db/client.js';
import type { ShipEvent } from '../events/IEventBus.js';
import { HmacSigner } from './HmacSigner.js';

interface WebhookSubscription {
  id: string;
  target_url: string;
  event_types: string[];
  signing_secret: string;
}

export class InMemoryWebhookDeliverer {
  async deliver(event: ShipEvent): Promise<void> {
    const result = await pool.query<WebhookSubscription>(
      `SELECT id, target_url, event_types, signing_secret
       FROM webhook_subscriptions
       WHERE enabled = TRUE
         AND (event_types = '{}' OR $1 = ANY(event_types))`,
      [event.type]
    );

    const rawBody = JSON.stringify(event);
    await Promise.all(result.rows.map((sub) => this.send(sub, rawBody, event)));
  }

  private async send(sub: WebhookSubscription, rawBody: string, event: ShipEvent): Promise<void> {
    const idempotencyKey = crypto.randomUUID();
    const signature = HmacSigner.sign(rawBody, sub.signing_secret);
    const start = Date.now();
    let status: number | null = null;

    try {
      const res = await fetch(sub.target_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ship-Signature': signature,
          'Ship-Event-Type': event.type,
          'Idempotency-Key': idempotencyKey,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch {
      status = null;
    }

    const latencyMs = Date.now() - start;
    const deadLetteredAt = status !== null && status >= 400 && status < 500 && status !== 429 ? new Date() : null;

    // Record delivery attempt in webhook_deliveries
    await pool.query(
      `INSERT INTO webhook_deliveries
         (subscription_id, event_type, payload, idempotency_key, attempt_number, response_status, latency_ms, dead_lettered_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, NULL)`,
      [sub.id, event.type, rawBody, idempotencyKey, status, latencyMs, deadLetteredAt]
    ).catch(console.error);
  }
}

export const webhookDeliverer = new InMemoryWebhookDeliverer();
