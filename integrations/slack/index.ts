import crypto from 'crypto';

export function verifyShipSignature(header: string, rawBody: string, secret: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10);
  if (Math.abs(age) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

export async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.ok;
}

export function buildSlackMessage(event: { type: string; payload: Record<string, unknown> }): string {
  return `*Ship Event:* \`${event.type}\`\n${JSON.stringify(event.payload, null, 2)}`;
}
