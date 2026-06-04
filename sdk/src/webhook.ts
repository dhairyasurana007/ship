import crypto from 'crypto';

export function verifyWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  secret: string,
  toleranceSec = 300,
): boolean {
  const sigHeader = (headers['ship-signature'] ?? headers['Ship-Signature'] ?? '') as string;
  if (!sigHeader) return false;

  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10);
  if (Math.abs(age) > toleranceSec) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
