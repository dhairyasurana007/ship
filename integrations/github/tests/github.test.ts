import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  buildGitHubComment,
  createGitHubAppJwt,
  handleShipWebhook,
  verifyShipSignature,
} from '../index.js';

function makeHeader(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('GitHub integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a GitHub App JWT', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = createGitHubAppJwt('123', privateKey.export({ format: 'pem', type: 'pkcs1' }).toString('utf8'));
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('verifies Ship signatures', () => {
    const body = JSON.stringify({ type: 'issue.assigned', payload: {} });
    const header = makeHeader(body, 'secret');
    expect(verifyShipSignature(header, body, 'secret')).toBe(true);
  });

  it('builds a readable GitHub comment', () => {
    const msg = buildGitHubComment({
      type: 'issue.assigned',
      payload: {
        issue: { title: 'Fix login', html_url: 'https://ship.local/issues/1' },
      },
    });
    expect(msg).toContain('Fix login');
    expect(msg).toContain('Event: issue.assigned');
  });

  it('posts a comment to a linked GitHub PR when a Ship webhook is signed', async () => {
    const body = JSON.stringify({
      type: 'issue.assigned',
      payload: {
        issue: { title: 'Fix login', html_url: 'https://ship.local/issues/1' },
        github_pull_request_url: 'https://github.com/acme/ship/pull/42',
      },
    });
    const header = makeHeader(body, 'ship-secret');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'installation-token' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }));

    const handled = await handleShipWebhook(body, header, {
      shipSigningSecret: 'ship-secret',
      githubAppId: '123',
      githubInstallationId: '456',
      githubPrivateKey: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString('utf8'),
      repository: { owner: 'acme', repo: 'ship' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/app/installations/456/access_tokens',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/acme/ship/issues/42/comments',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
