# Epic 6 — CLI Reference Integration

## Before

No CLI. The "five-line developer story" could not be demonstrated.

## Fix

`integrations/cli/` — `ship` binary using `commander`, imports only `@ship-dhairya/sdk`. `ship login` (Device Grant → token saved to `~/.ship/token.json`). `ship docs ls/get/create`. `ship webhooks tail` (SSE stream, prints each delivery with `✓ verified` / `✗ invalid`). `integrations/cli/tests/ttfe.drill.ts` — end-to-end drill: login → subscribe → create doc → receive signed delivery → verify. CI auto-approval via `SHIP_DEVICE_CODE` env var.

## After

The full developer story works: `pnpm install @ship-dhairya/sdk` → `ship login` → `ship docs create` → `ship webhooks tail` → signed event arrives verified.

## Proof

TTFE drill: `pnpm drill ttfe` exits 0 in < 60s. `pnpm lint integrations/cli` exits 0 (no api/src imports).

