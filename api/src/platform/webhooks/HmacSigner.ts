import crypto from 'crypto';

export class HmacSigner {
  static sign(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const payload = `${timestamp}.${rawBody}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `t=${timestamp},v1=${sig}`;
  }

  static verify(header: string, rawBody: string, secret: string, toleranceSec = 300): boolean {
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
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
}
