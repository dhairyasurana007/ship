type SameSite = 'strict' | 'lax' | 'none';

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function parseSameSite(value: string | undefined, fallback: SameSite): SameSite {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'strict' || v === 'lax' || v === 'none') return v;
  return fallback;
}

// Cross-origin deployments (CORS_ORIGIN set to a non-localhost URL) require
// SameSite=None; Secure so browsers will include cookies in cross-origin fetches.
function isCrossOriginDeployment(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const origin = process.env.CORS_ORIGIN || '';
  return !!origin && !origin.includes('localhost') && !origin.includes('127.0.0.1');
}

const crossOrigin = isCrossOriginDeployment();

export const sessionCookieSecure = parseBool(
  process.env.SESSION_COOKIE_SECURE,
  crossOrigin
);

export const sessionCookieProxy = parseBool(
  process.env.SESSION_COOKIE_PROXY,
  crossOrigin
);

export const sessionCookieSameSite = parseSameSite(
  process.env.SESSION_COOKIE_SAMESITE,
  crossOrigin ? 'none' : 'strict'
);

