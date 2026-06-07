import { FileTokenStore } from '../store/FileTokenStore.js';

export interface TokenStore {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface DeviceLoginOptions {
  onUserCode: (code: DeviceCodeResponse) => void;
  baseUrl?: string;
  tokenStore?: TokenStore;
  clientId?: string;
  scope?: string;
}

interface DeviceTokenSuccess {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  message?: string;
  oauth_client_id?: string;
  client_id?: string;
  api_base_url?: string;
}

interface ParsedResponse<T> {
  ok: boolean;
  data: T | null;
  contentType: string | null;
  rawText: string;
}

const DEFAULT_BASE_URL = 'https://ship-api-ysxi.onrender.com';
const DEFAULT_SCOPE = 'documents:read documents:write issues:read issues:write sprints:read sprints:write webhooks:manage';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const POLL_RETRY_DELAY_MS = 5000;

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const readJsonResponse = async <T>(response: Response): Promise<ParsedResponse<T>> => {
  const contentType = response.headers.get('content-type');
  const rawText = await response.text();

  if (!rawText.trim()) {
    return { ok: response.ok, data: null, contentType, rawText };
  }

  try {
    return { ok: response.ok, data: JSON.parse(rawText) as T, contentType, rawText };
  } catch {
    return { ok: response.ok, data: null, contentType, rawText };
  }
};

const formatUnexpectedResponseError = (context: string, response: ParsedResponse<unknown> & { status: number; statusText: string }): Error => {
  const preview = response.rawText.trim().replace(/\s+/g, ' ').slice(0, 160);
  const details = [
    `${response.status} ${response.statusText}`.trim(),
    response.contentType ? `content-type=${response.contentType}` : null,
    preview ? `body=${preview}` : null,
  ].filter(Boolean).join(', ');

  return new Error(`${context} returned an unexpected response (${details}).`);
};

const postForm = async <T>(url: string, body: URLSearchParams): Promise<{ ok: boolean; data: T }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const parsed = await readJsonResponse<T>(response);
  if (parsed.data === null) {
    throw formatUnexpectedResponseError(`POST ${url}`, { ...parsed, status: response.status, statusText: response.statusText });
  }

  const data = parsed.data;
  return { ok: response.ok, data };
};

const discoverShipOAuthClientId = async (baseUrl: string): Promise<string> => {
  const discoveryUrl = new URL('/.well-known/ship.json', baseUrl);
  const response = await fetch(discoveryUrl);
  const parsed = await readJsonResponse<OAuthErrorResponse>(response);

  if (!parsed.ok) {
    if (parsed.data && typeof parsed.data === 'object') {
      const errorData = parsed.data as OAuthErrorResponse;
      throw new Error(errorData.message ?? errorData.error_description ?? `Unable to discover Ship OAuth client id from ${discoveryUrl.toString()}.`);
    }

    throw formatUnexpectedResponseError(`GET ${discoveryUrl.toString()}`, { ...parsed, status: response.status, statusText: response.statusText });
  }

  const clientId = parsed.data?.oauth_client_id ?? parsed.data?.client_id;
  if (!clientId) {
    throw new Error('Ship discovery document did not include an OAuth client id.');
  }

  return clientId;
};

export async function deviceLoginFlow(opts: DeviceLoginOptions): Promise<string> {
  const tokenStore = opts.tokenStore ?? new FileTokenStore();
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const clientId = opts.clientId ?? await discoverShipOAuthClientId(baseUrl);
  const scope = opts.scope ?? DEFAULT_SCOPE;

  const deviceCodeResult = await postForm<DeviceCodeResponse | OAuthErrorResponse>(
    `${baseUrl}/oauth/device/code`,
    new URLSearchParams({
      client_id: clientId,
      scope,
    }),
  );

  if (!deviceCodeResult.ok) {
    const error = deviceCodeResult.data as OAuthErrorResponse;
    throw new Error(error.error_description ?? error.error ?? 'Failed to start device login.');
  }

  const deviceCode = deviceCodeResult.data as DeviceCodeResponse;
  opts.onUserCode(deviceCode);

  let pollIntervalMs = deviceCode.interval * 1000;
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await sleep(pollIntervalMs);

    const tokenResult = await postForm<DeviceTokenSuccess | OAuthErrorResponse>(
      `${baseUrl}/oauth/token`,
      new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        client_id: clientId,
        device_code: deviceCode.device_code,
      }),
    );

    const tokenData = tokenResult.data as DeviceTokenSuccess | OAuthErrorResponse;

    if ('access_token' in tokenData) {
      await tokenStore.save(tokenData.access_token);
      return tokenData.access_token;
    }

    if (tokenData.error === 'authorization_pending') {
      continue;
    }

    if (tokenData.error === 'slow_down') {
      pollIntervalMs += POLL_RETRY_DELAY_MS;
      continue;
    }

    if (tokenData.error === 'expired_token') {
      throw new Error('Device code expired. Run ship login again.');
    }

    throw new Error(tokenData.error_description ?? tokenData.error);
  }

  throw new Error('Device code expired. Run ship login again.');
}
