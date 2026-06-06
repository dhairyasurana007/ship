import { describe, it, expect } from 'vitest';
import { ShipClient } from '../ShipClient.js';

describe('ShipClient.authorizationCodeFlow', () => {
  it('builds a PKCE authorize URL with the provided options', () => {
    const flow = ShipClient.authorizationCodeFlow({
      clientId: 'client-123',
      redirectUri: 'https://example.com/callback',
      baseUrl: 'https://ship.example.gov',
      scope: 'documents:read documents:write',
    });

    const { url, codeVerifier } = flow.buildAuthorizationUrl('state-1');
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://ship.example.gov');
    expect(parsed.pathname).toBe('/oauth/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/callback');
    expect(parsed.searchParams.get('scope')).toBe('documents:read documents:write');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state-1');
    expect(codeVerifier).toBeTruthy();
    expect(codeVerifier).not.toBe(parsed.searchParams.get('code_challenge'));
  });
});
