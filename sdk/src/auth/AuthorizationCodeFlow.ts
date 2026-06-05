import crypto from 'crypto';
import type { TokenStore } from './DeviceFlow.js';
import { FileTokenStore } from '../store/FileTokenStore.js';

export interface AuthCodeFlowOptions {
  clientId: string;
  redirectUri: string;
  scope?: string;
  baseUrl?: string;
  tokenStore?: TokenStore;
}

const DEFAULT_BASE_URL = 'https://ship-api-ysxi.onrender.com';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export class AuthorizationCodeFlow {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;

  constructor(private readonly opts: AuthCodeFlowOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.tokenStore = opts.tokenStore ?? new FileTokenStore();
  }

  buildAuthorizationUrl(state?: string): { url: string; codeVerifier: string } {
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const url = new URL('/oauth/authorize', this.baseUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.opts.clientId);
    url.searchParams.set('redirect_uri', this.opts.redirectUri);
    url.searchParams.set('scope', this.opts.scope ?? 'documents:read');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (state) url.searchParams.set('state', state);
    return { url: url.toString(), codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: this.opts.redirectUri,
        client_id: this.opts.clientId,
      }),
    });
    const body = await response.json() as any;
    if (!response.ok) throw new Error(body.error_description ?? body.error ?? 'Token exchange failed');
    await this.tokenStore.save(body.access_token as string);
    return body.access_token as string;
  }
}
