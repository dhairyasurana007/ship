import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { HmacSigner } from './HmacSigner.js';
import type { IClock } from './IClock.js';
import { WallClock } from './IClock.js';

// Retry schedule delays in ms: 1s, 4s, 16s, 1m, 5m, 30m
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000, 60_000, 300_000, 1_800_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 7 total attempts

function jitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

interface DeliveryRow {
  id: string;
  subscription_id: string;
  payload: string;
  idempotency_key: string;
  attempt_number: number;
  target_url: string;
  signing_secret: string;
}

export class WebhookRetryScheduler {
  constructor(private readonly clock: IClock = new WallClock()) {}

  async scheduleDelivery(
    subscriptionId: string,
    eventType: string,
    payload: string,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<void> {
    await pool.query(
      `INSERT INTO webhook_deliveries (subscription_id, event_type, payload, idempotency_key, next_attempt_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [subscriptionId, eventType, payload, idempotencyKey]
    );
  }

  async processDue(): Promise<void> {
    const result = await pool.query<DeliveryRow>(
      `SELECT wd.id, wd.subscription_id, wd.payload, wd.idempotency_key, wd.attempt_number,
              ws.target_url, ws.signing_secret
       FROM webhook_deliveries wd
       JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id
       WHERE wd.next_attempt_at <= NOW()
         AND wd.dead_lettered_at IS NULL
       LIMIT 100`
    );

    await Promise.all(result.rows.map((row) => this.attempt(row)));
  }

  private async attempt(row: DeliveryRow): Promise<void> {
    const start = this.clock.now();
    let status: number | null = null;

    try {
      const signature = HmacSigner.sign(row.payload, row.signing_secret);
      const res = await fetch(row.target_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ship-Signature': signature,
          'Idempotency-Key': row.idempotency_key,
        },
        body: row.payload,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch {
      status = null;
    }

    const latencyMs = this.clock.now() - start;
    const success = status !== null && status >= 200 && status < 300;
    const clientError = status !== null && status >= 400 && status < 500 && status !== 429;

    if (success) {
      await pool.query(
        `UPDATE webhook_deliveries
         SET response_status=$1, latency_ms=$2, next_attempt_at=NULL
         WHERE id=$3`,
        [status, latencyMs, row.id]
      );
      return;
    }

    const nextAttempt = row.attempt_number + 1;
    const deadLetter = clientError || nextAttempt > MAX_ATTEMPTS;

    if (deadLetter) {
      await pool.query(
        `UPDATE webhook_deliveries
         SET response_status=$1, latency_ms=$2, dead_lettered_at=NOW(), next_attempt_at=NULL, attempt_number=$3
         WHERE id=$4`,
        [status, latencyMs, row.attempt_number, row.id]
      );
      return;
    }

    const delayMs = jitter(RETRY_DELAYS_MS[nextAttempt - 2] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 1_000);
    const nextAt = new Date(this.clock.now() + delayMs);

    await pool.query(
      `UPDATE webhook_deliveries
       SET response_status=$1, latency_ms=$2, attempt_number=$3, next_attempt_at=$4
       WHERE id=$5`,
      [status, latencyMs, nextAttempt, nextAt, row.id]
    );
  }

  async replay(deliveryId: string): Promise<void> {
    await pool.query(
      `UPDATE webhook_deliveries
       SET dead_lettered_at=NULL, next_attempt_at=NOW(), attempt_number=1
       WHERE id=$1`,
      [deliveryId]
    );
  }
}

export const retryScheduler = new WebhookRetryScheduler();
