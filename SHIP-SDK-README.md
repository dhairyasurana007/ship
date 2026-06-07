# Ship SDK and CLI README

This guide covers first-time installation and use of the Ship SDK and `ship` CLI against the live API.

## What you need

- Node.js 20 or newer
- `pnpm`
- A working internet connection to the live Ship API

You do **not** need:

- a local `ship-api`
- local PostgreSQL
- `SHIP_OAUTH_CLIENT_ID`

## Install

From the repository root:

```bash
pnpm install
```

## Build

Build the SDK first, then the CLI:

```bash
pnpm build:sdk
pnpm build:cli
```

## First login

Run the login command against the live API:

```bash
ship login
```

If `ship` is not on your `PATH`, run the built CLI directly:

```bash
node integrations/cli/dist/index.js login
```

During login:

1. The CLI discovers the OAuth client id from the live API.
2. The CLI prints a user code and verification URL.
3. You open the verification URL, sign in on the API-hosted device approval page, and approve the device code.
4. The CLI stores the access token locally.

## Use the CLI

After login, list documents with:

```bash
ship docs ls
```

If you want to paginate:

```bash
ship docs ls <cursor>
```

## Expected behavior

- `ship login` should start the device flow automatically.
- `ship docs ls` should print document titles after login.
- If you are not logged in, `ship docs ls` should fail with:

```text
Not logged in. Run: ship login
```

## Troubleshooting

### `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

This means the CLI tried to read the discovery endpoint and received HTML instead of JSON. The live API must serve:

```text
/.well-known/ship.json
```

If that endpoint returns `404` or HTML, `ship login` cannot start the device flow.
Use the exact verification URL the CLI prints; the device approval page is served by the API host.

### Login never finishes

- Make sure you approved the device code on the API-hosted device approval page.
- Make sure the live API is reachable.
- Retry `ship login` if the device code expired.

## Minimal first-time flow

```bash
pnpm install
pnpm build:sdk
pnpm build:cli
ship login
ship docs ls
```
