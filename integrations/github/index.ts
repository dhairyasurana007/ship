import crypto from "node:crypto";

export interface ShipWebhookEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface GitHubBridgeConfig {
  shipSigningSecret: string;
  githubAppId: string;
  githubInstallationId: string;
  githubPrivateKey: string;
  repository: {
    owner: string;
    repo: string;
  };
  fetchImpl?: typeof fetch;
}

export function verifyShipSignature(
  header: string,
  rawBody: string,
  secret: string,
  toleranceSec = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=")),
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const age = Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10);
  if (Math.abs(age) > toleranceSec) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

export function createGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000) - 30;
  const expiresAt = issuedAt + 9 * 60;
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: appId }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(unsigned), privateKeyPem)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

async function createInstallationAccessToken(
  config: GitHubBridgeConfig,
): Promise<string> {
  const jwt = createGitHubAppJwt(config.githubAppId, config.githubPrivateKey);
  const response = await (config.fetchImpl ?? fetch)(
    `https://api.github.com/app/installations/${config.githubInstallationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  const body = (await response.json()) as { token?: string; message?: string };
  if (!response.ok || !body.token) {
    throw new Error(
      body.message ??
        `Failed to create GitHub installation token (${response.status})`,
    );
  }

  return body.token;
}

function parsePullRequestUrl(url: string): {
  owner: string;
  repo: string;
  number: string;
} {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const [owner, repo, pull, number] = parts;
  if (!owner || !repo || pull !== "pull" || !number) {
    throw new Error(`Unsupported GitHub pull request URL: ${url}`);
  }

  return { owner, repo, number };
}

export function buildGitHubComment(event: ShipWebhookEvent): string {
  const issue = event.payload["issue"];
  const issueTitle =
    typeof issue === "object" && issue !== null && "title" in issue
      ? String((issue as { title?: unknown }).title ?? "")
      : "Ship issue";
  const issueUrl =
    typeof issue === "object" && issue !== null && "html_url" in issue
      ? String((issue as { html_url?: unknown }).html_url ?? "")
      : "";

  const lines = [`Ship linked issue: ${issueTitle}`.trim()];

  if (issueUrl) {
    lines.push(`Issue: ${issueUrl}`);
  }

  lines.push(`Event: ${event.type}`);
  return lines.join("\n");
}

export async function handleShipWebhook(
  rawBody: string,
  shipSignatureHeader: string,
  config: GitHubBridgeConfig,
): Promise<boolean> {
  if (
    !verifyShipSignature(shipSignatureHeader, rawBody, config.shipSigningSecret)
  ) {
    return false;
  }

  const event = JSON.parse(rawBody) as ShipWebhookEvent;
  if (event.type !== "issue.assigned" && event.type !== "document.created") {
    return false;
  }

  const pullRequestUrl = String(
    event.payload["github_pull_request_url"] ??
      event.payload["pull_request_url"] ??
      "",
  );
  if (!pullRequestUrl) {
    return false;
  }

  const { owner, repo, number } = parsePullRequestUrl(pullRequestUrl);
  const token = await createInstallationAccessToken(config);
  const response = await (config.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ body: buildGitHubComment(event) }),
    },
  );

  return response.ok;
}
