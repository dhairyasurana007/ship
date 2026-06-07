# Epic 3 — Documents Resource + OpenAPI 3.1 Spec

## Before

No public documents endpoint. No machine-readable API spec.

## Fix

`GET /api/v1/docs` (cursor pagination), `GET /api/v1/docs/:id`, `POST /api/v1/docs` — all delegating to existing `DocumentService`. Consistent `ApiError { code, message, details?, request_id }` shape enforced by `errorHandler.ts` middleware. `openapi/generator.ts` walks the router stack and emits OpenAPI 3.1 JSON from `registerRoute()` metadata. Fitness test asserts 100% spec ↔ route parity.

## After

Documents API is publicly accessible with typed, versioned contract. OpenAPI spec served live at `/api/v1/openapi.json` and committed statically at `docs/openapi.json`.

## Proof

`api/src/platform/__tests__/openapi.test.ts` validates against OpenAPI 3.1 meta-schema with 0 AJV errors. `api-contract.fitness.test.ts` asserts ApiError shape on all failure paths.
