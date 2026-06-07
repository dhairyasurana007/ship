# Epic 4 — TypeScript SDK (@ship-dhairya/sdk)

## Before

No SDK. Developers had to hand-roll HTTP calls, manage pagination, and implement webhook verification themselves.

## Fix

`sdk/` workspace package with `ShipClient`, `DocumentsClient` (list/get/create/iterate async generator), `IssuesClient`, `SprintsClient`, `WebhooksClient`. `DeviceFlow.ts` handles polling loop with `slow_down` support. `FileTokenStore.ts` persists tokens to `~/.ship/token.json`. `verifyWebhook()` validates Stripe-style HMAC signatures. `ShipError` discriminated union with `kind` field for exhaustive `switch`.

## After

Developers can `npm install @ship-dhairya/sdk` and reach a verified signed webhook in under 30 minutes.

## Proof

`sdk/src/__tests__/ShipClient.integration.test.ts` passes. `openapi-parity.test.ts` asserts 0 drift between spec and SDK methods.

