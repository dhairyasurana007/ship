import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  buildSlackMessage,
  handleShipWebhook,
  postToSlackChannel,
  verifyShipSignature,
} from '../index.js';

function makeHeader(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('Slack integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid Ship-Signature', () => {
    const secret = 'test-signing-secret';
    const body = JSON.stringify({ type: 'document.created', payload: { id: '123' } });
    const header = makeHeader(body, secret);
    expect(verifyShipSignature(header, body, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = 'test-signing-secret';
    const body = JSON.stringify({ type: 'document.created', payload: { id: '123' } });
    const header = makeHeader(body, secret);
    expect(verifyShipSignature(header, body + 'x', secret)).toBe(false);
  });

  it('builds a readable Slack message', () => {
    const msg = buildSlackMessage({ type: 'document.created', payload: { id: '123', title: 'Test' } });
    expect(msg).toContain('document.created');
    expect(msg).toContain('Test');
  });

  it('posts to Slack via chat.postMessage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const posted = await postToSlackChannel('xoxb-test', 'C123', 'hello', fetchMock as unknown as typeof fetch);

    expect(posted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('routes signed Ship webhooks to the configured channel', async () => {
    const event = { type: 'document.created', payload: { id: 'doc-1', title: 'Spec' } };
    const rawBody = JSON.stringify(event);
    const header = makeHeader(rawBody, 'bridge-secret');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const handled = await handleShipWebhook(rawBody, header, {
      botToken: 'xoxb-test',
      signingSecret: 'bridge-secret',
      channels: {
        'document.created': 'C123',
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
