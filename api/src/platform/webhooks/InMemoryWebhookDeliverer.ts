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
    await Promise.all(
      result.rows.map((sub) => this.send(sub, rawBody, event))
    );
  }

  private async send(sub: WebhookSubscription, rawBody: string, event: ShipEvent): Promise<void> {
    const signature = HmacSigner.sign(rawBody, sub.signing_secret);
    try {
      await fetch(sub.target_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ship-Signature': signature,
          'Ship-Event-Type': event.type,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Delivery failures are silenced here; retry handled by F5
    }
  }
}

export const webhookDeliverer = new InMemoryWebhookDeliverer();
