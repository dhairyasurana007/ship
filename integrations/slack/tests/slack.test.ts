import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyShipSignature, buildSlackMessage } from '../index.js';

function makeHeader(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('Slack integration — signature verification', () => {
  const secret = 'test-signing-secret';
  const body = JSON.stringify({ type: 'document.created', payload: { id: '123' } });

  it('accepts a valid Ship-Signature', () => {
    const header = makeHeader(body, secret);
    expect(verifyShipSignature(header, body, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = makeHeader(body, secret);
    expect(verifyShipSignature(header, body + 'x', secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const header = makeHeader(body, secret);
    expect(verifyShipSignature(header, body, 'wrong-secret')).toBe(false);
  });

  it('builds a readable Slack message', () => {
    const msg = buildSlackMessage({ type: 'document.created', payload: { id: '123', title: 'Test' } });
    expect(msg).toContain('document.created');
    expect(msg).toContain('Test');
  });
});
