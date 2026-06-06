import crypto from "node:crypto";

export type ShipWebhookEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export interface SlackBridgeConfig {
  botToken: string;
  signingSecret: string;
  channels: Partial<Record<"document.created" | "issue.assigned", string>>;
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

export async function postToSlackChannel(
  botToken: string,
  channel: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });

  if (!response.ok) {
    return false;
  }

  const body = (await response.json()) as { ok?: boolean };
  return body.ok !== false;
}

export function buildSlackMessage(event: ShipWebhookEvent): string {
  return [
    `*Ship Event:* \`${event.type}\``,
    "```json",
    JSON.stringify(event.payload, null, 2),
    "```",
  ].join("\n");
}

export async function handleShipWebhook(
  rawBody: string,
  shipSignatureHeader: string,
  config: SlackBridgeConfig,
): Promise<boolean> {
  if (
    !verifyShipSignature(shipSignatureHeader, rawBody, config.signingSecret)
  ) {
    return false;
  }

  const event = JSON.parse(rawBody) as ShipWebhookEvent;
  const channel =
    config.channels[event.type as keyof SlackBridgeConfig["channels"]];
  if (!channel) {
    return false;
  }

  const text = buildSlackMessage(event);
  return postToSlackChannel(config.botToken, channel, text, config.fetchImpl);
}
