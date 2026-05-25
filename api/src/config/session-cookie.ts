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

export const sessionCookieSecure = parseBool(
  process.env.SESSION_COOKIE_SECURE,
  process.env.NODE_ENV === 'production'
);

export const sessionCookieProxy = parseBool(
  process.env.SESSION_COOKIE_PROXY,
  process.env.NODE_ENV === 'production'
);

export const sessionCookieSameSite = parseSameSite(
  process.env.SESSION_COOKIE_SAMESITE,
  process.env.NODE_ENV === 'production' ? 'none' : 'strict'
);

