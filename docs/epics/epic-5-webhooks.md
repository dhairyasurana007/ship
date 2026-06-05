# Epic 5 — Webhook Pipeline (Event Bus → Signer → Deliverer → Retry → DLQ)

## Before

No webhook system. Document mutations had no observable side effects for external subscribers.

## Fix

`IEventBus` interface + `InMemoryEventBus`. `DocumentService.create/update/delete` publishes events. `HmacSigner` computes `Ship-Signature: t=<unix>,v1=<hex-hmac>`. `InMemoryWebhookDeliverer` matches subscriptions, signs, delivers via `fetch`. Retry scheduler with `IClock` injection — schedule: 1s, 4s, 16s, 1m, 5m, 30m ±10% jitter. 5xx → retry; 4xx (except 429) → dead-letter. After 6 failures → `dead_lettered_at`. Delivery log in `webhook_deliveries` table. Replay endpoint preserves original `Idempotency-Key`.

## After

Subscribers receive signed webhook deliveries within 2s P95. Failed deliveries retry automatically and land in DLQ for manual replay.

## Proof

`api/src/platform/webhooks/retry.test.ts` completes in < 1s using `FakeClock`. E2E test verifies signed delivery within 2s, tampered body rejection, and DLQ replay with original idempotency key.
