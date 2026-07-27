/**
 * Selected-sport persistence for the player app.
 *
 * Almost every player query is sport-scoped, so the shell has to know the sport
 * before it renders. A cookie is the only store the server can read, which is what
 * keeps the first paint from flashing a sport-less shell. Not the URL (it would
 * double the route surface and leak the sender's sport into every shared link),
 * and not localStorage alone (invisible to the server).
 *
 * Not httpOnly on purpose: the client provider reads it during hydration, and a
 * sport id is not sensitive.
 */
export const SPORT_COOKIE = 'rallia_sport';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const sportCookieOptions = {
  path: '/',
  sameSite: 'lax',
  maxAge: ONE_YEAR_SECONDS,
} as const;

/**
 * Reads the cookie from a server request's headers.
 *
 * Takes the header list rather than calling `cookies()` so the layout can reuse the
 * `headers()` call it already awaited, and so this stays usable from middleware.
 */
export function readSportCookie(headerList: Headers): string | null {
  const cookieHeader = headerList.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.split('=');
    if (rawName?.trim() === SPORT_COOKIE) {
      const value = rawValue.join('=').trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/** Reads the cookie in the browser. Returns null during SSR. */
export function readSportCookieClient(): string | null {
  if (typeof document === 'undefined') return null;
  return readSportCookie(new Headers({ cookie: document.cookie }));
}

/**
 * Writes the cookie in the browser.
 *
 * Done client-side rather than through a server action so switching sports is
 * instant: no round trip, no flash. A server action would also force an RSC
 * refresh on every switch for no benefit while nothing server-rendered reads it.
 */
export function writeSportCookieClient(sportId: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${SPORT_COOKIE}=${encodeURIComponent(sportId)}; path=${sportCookieOptions.path}; max-age=${sportCookieOptions.maxAge}; samesite=${sportCookieOptions.sameSite}`;
}
