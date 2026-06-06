import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_URL = "https://ship-api-ysxi.onrender.com";
const WEB_URL = "https://ship-web-ak37.onrender.com";
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  "api-playwright-test",
  "evidence",
);

function ensureEvidenceDir(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function randomBase64Url(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

async function fetchDiscoveryClientId(): Promise<string> {
  const response = await fetch(`${API_URL}/.well-known/ship.json`);
  expect(response.ok).toBeTruthy();

  const body = (await response.json()) as { oauth_client_id?: string };
  expect(
    body.oauth_client_id,
    "Discovery doc should expose oauth_client_id",
  ).toBeTruthy();
  return body.oauth_client_id ?? "";
}

async function approveAuthorization(
  page: Page,
  request: APIRequestContext,
  authorizeUrl: URL,
  screenshotName: string,
): Promise<{ code: string; callbackUrl: string }> {
  const getResponse = await request.get(authorizeUrl.toString());
  expect(getResponse.ok(), "Authorize page should load").toBeTruthy();
  const html = await getResponse.text();

  await page.setContent(html);
  await expect(page.getByRole("heading", { name: /authorize/i })).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, screenshotName),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(
      EVIDENCE_DIR,
      `${path.basename(screenshotName, ".png")}-cookies.json`,
    ),
    JSON.stringify((await request.storageState()).cookies, null, 2),
  );
  fs.writeFileSync(
    path.join(
      EVIDENCE_DIR,
      `${path.basename(screenshotName, ".png")}-page.html`,
    ),
    html,
  );

  const postResponse = await request.post(authorizeUrl.toString(), {
    form: {
      email: "dev@ship.local",
      password: "admin123",
      action: "approve",
    },
  });

  const callbackUrl = postResponse.url();
  const parsed = new URL(callbackUrl);
  const code = parsed.searchParams.get("code") ?? "";
  expect(
    code,
    "Authorization callback should include an authorization code",
  ).toBeTruthy();
  return { code, callbackUrl };
}

test("live ship OAuth PKCE flow and invalid_grant negative case", async ({
  page,
  request,
}) => {
  ensureEvidenceDir();

  const clientId = await fetchDiscoveryClientId();
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "discovery.json"),
    JSON.stringify({ apiUrl: API_URL, clientId }, null, 2),
  );

  const redirectUri = `${WEB_URL}/oauth/callback`;
  const scope = "documents:read";

  const codeVerifier = randomBase64Url();
  const state = randomBase64Url(16);
  const authorizeUrl = new URL("/oauth/authorize", API_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge(codeVerifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);

  const positive = await approveAuthorization(
    page,
    request,
    authorizeUrl,
    "authorize-page.png",
  );

  const tokenResponse = await fetch(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: positive.code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    }),
  });
  const tokenBody = (await tokenResponse.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  expect(tokenResponse.status, JSON.stringify(tokenBody)).toBe(200);
  expect(tokenBody.access_token).toBeTruthy();
  expect(tokenBody.token_type).toBe("Bearer");

  const meResponse = await fetch(`${API_URL}/api/v1/me`, {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
    },
  });
  const meBody = (await meResponse.json()) as {
    id?: string;
    name?: string;
    email?: string;
  };
  expect(meResponse.ok, JSON.stringify(meBody)).toBeTruthy();

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "positive-token.json"),
    JSON.stringify(
      {
        authorizeUrl: authorizeUrl.toString(),
        callbackUrl: positive.callbackUrl,
        tokenStatus: tokenResponse.status,
        tokenType: tokenBody.token_type,
        expiresIn: tokenBody.expires_in,
        meStatus: meResponse.status,
        meBody,
      },
      null,
      2,
    ),
  );

  const wrongVerifier = "wrong-verifier-that-will-not-match";
  const wrongState = randomBase64Url(16);
  const wrongCodeVerifier = randomBase64Url();
  const wrongAuthorizeUrl = new URL("/oauth/authorize", API_URL);
  wrongAuthorizeUrl.searchParams.set("response_type", "code");
  wrongAuthorizeUrl.searchParams.set("client_id", clientId);
  wrongAuthorizeUrl.searchParams.set("redirect_uri", redirectUri);
  wrongAuthorizeUrl.searchParams.set("scope", scope);
  wrongAuthorizeUrl.searchParams.set(
    "code_challenge",
    codeChallenge(wrongCodeVerifier),
  );
  wrongAuthorizeUrl.searchParams.set("code_challenge_method", "S256");
  wrongAuthorizeUrl.searchParams.set("state", wrongState);

  const wrongFlow = await approveAuthorization(
    page,
    request,
    wrongAuthorizeUrl,
    "authorize-page-negative.png",
  );
  const wrongTokenResponse = await fetch(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: wrongFlow.code,
      code_verifier: wrongVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    }),
  });
  const wrongTokenBody = (await wrongTokenResponse.json()) as {
    error?: string;
    error_description?: string;
  };

  expect(wrongTokenResponse.status).toBe(400);
  expect(wrongTokenBody.error).toBe("invalid_grant");

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "negative-invalid-grant.json"),
    JSON.stringify(
      {
        authorizeUrl: wrongAuthorizeUrl.toString(),
        callbackUrl: wrongFlow.callbackUrl,
        status: wrongTokenResponse.status,
        body: wrongTokenBody,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "summary.md"),
    [
      "# Live OAuth PKCE evidence",
      "",
      `- Discovery client_id: \`${clientId}\``,
      `- Positive authorize callback: \`${positive.callbackUrl}\``,
      `- Positive token exchange: HTTP ${tokenResponse.status}`,
      `- Usable access token: \`${meResponse.status}\` from \`GET /api/v1/me\``,
      `- Negative token exchange: HTTP ${wrongTokenResponse.status} with \`${wrongTokenBody.error}\``,
    ].join("\n"),
  );
});
