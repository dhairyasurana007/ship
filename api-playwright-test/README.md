# API Playwright Evidence

This folder contains the live OAuth Authorization Code + PKCE evidence run against:

- API: `https://ship-api-ysxi.onrender.com`
- Web app: `https://ship-web-ak37.onrender.com`
- Credentials: `dev@ship.local / admin123`

Artifacts:

- `evidence/discovery.json` — public discovery document proving the live `oauth_client_id`
- `evidence/authorize-page.png` — authorize consent page screenshot
- `evidence/authorize-page-page.html` — HTML rendered for the consent screen
- `evidence/authorize-page-cookies.json` — session cookie captured after the authorize GET
- `evidence/positive-token.json` — successful `/oauth/token` exchange and usable `GET /api/v1/me`
- `evidence/negative-invalid-grant.json` — wrong `code_verifier` returning `invalid_grant`
- `evidence/summary.md` — one-page run summary

The Playwright spec that produced the evidence is `oauth-pkce-live.spec.ts`.
