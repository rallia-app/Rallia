import type { UtmParams } from '@rallia/shared-utils';

/**
 * Web equivalent of the mobile AsyncStorage UTM persistence in
 * `apps/mobile/App.tsx`. First-touch wins: once a UTM set is captured we
 * don't overwrite it on later visits, so a returning visitor's signup is
 * still attributed to the channel that originally drove them.
 *
 * Cleared by `PostHogIdentify` after the params are flushed to person
 * properties at signup.
 */

const COOKIE_NAME = 'rallia_utm';
const COOKIE_MAX_AGE_DAYS = 90;

export function readUtmCookie(): UtmParams | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find(row => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    const parsed = JSON.parse(decoded) as UtmParams;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** First-touch: only writes if no cookie is set yet. Returns whether it wrote. */
export function writeUtmCookieIfAbsent(params: UtmParams): boolean {
  if (typeof document === 'undefined') return false;
  if (readUtmCookie()) return false;
  const value = encodeURIComponent(JSON.stringify(params));
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  return true;
}

export function clearUtmCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}
