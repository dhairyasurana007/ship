export interface ClientCredentialsOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenStore?: {
    load(): Promise<string | null>;
    save(token: string): Promise<void>;
  };
  scope?: string;
}

interface ClientCredentialsSuccess {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  message?: string;
}

const DEFAULT_BASE_URL = 'https://ship-api-ysxi.onrender.com';

export async function clientCredentialsFlow(opts: ClientCredentialsOptions): Promise<string> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      ...(opts.scope ? { scope: opts.scope } : {}),
    }),
  });

  const body = (await response.json()) as ClientCredentialsSuccess | OAuthErrorResponse;
  if (!response.ok) {
    const errorBody = body as OAuthErrorResponse;
    throw new Error(errorBody.error_description ?? errorBody.error ?? 'Client credentials exchange failed');
  }

  const accessToken = (body as ClientCredentialsSuccess).access_token;
  if (!accessToken) {
    throw new Error('Client credentials exchange did not return an access token');
  }

  if (opts.tokenStore) {
    await opts.tokenStore.save(accessToken);
  }
  return accessToken;
}
