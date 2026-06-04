import { describe, it, expect } from 'vitest';
import { HmacSigner } from '../HmacSigner.js';

describe('HmacSigner', () => {
  const secret = 'test-secret-key';
  const body = '{"type":"document.created"}';

  it('produces a header with t= and v1= components', () => {
    const header = HmacSigner.sign(body, secret);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('verifies a freshly signed payload', () => {
    const header = HmacSigner.sign(body, secret);
    expect(HmacSigner.verify(header, body, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = HmacSigner.sign(body, secret);
    expect(HmacSigner.verify(header, body + 'x', secret)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const header = HmacSigner.sign(body, secret);
    expect(HmacSigner.verify(header, body, 'wrong-secret')).toBe(false);
  });

  it('rejects a stale timestamp', () => {
    const staleTs = Math.floor(Date.now() / 1000) - 400;
    const header = HmacSigner.sign(body, secret, staleTs);
    expect(HmacSigner.verify(header, body, secret, 300)).toBe(false);
  });
});
