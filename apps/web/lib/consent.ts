/**
 * Cookie consent model for Quebec Law 25 compliance.
 *
 * Law 25 (in force since Sept 2024) requires opt-in consent before any
 * non-essential tracking technology fires. Storage off by default; toggling
 * a category off must take effect immediately; preferences must be
 * revisitable at any time (see CookiePreferencesDialog).
 *
 * Categories:
 *   - necessary: session, auth, language, theme, the consent record itself.
 *     Always on, not toggleable.
 *   - analytics:  PostHog product analytics, Vercel Web Analytics, Sentry
 *     session replay. Opt-in.
 *   - marketing:  first-touch UTM cookie (rallia_utm), PostHog distinct_id
 *     mirror cookie (ph_did), attribution events. Opt-in.
 */

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing';

export interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: number;
  version: number;
}

export const CONSENT_VERSION = 1;
export const CONSENT_STORAGE_KEY = 'rallia_consent_v1';
export const CONSENT_COOKIE_NAME = 'rallia_consent';
export const CONSENT_EVENT = 'rallia:consent-changed';

const COOKIE_MAX_AGE_DAYS = 180;

export function isValidConsent(value: unknown): value is ConsentState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.necessary === true &&
    typeof v.analytics === 'boolean' &&
    typeof v.marketing === 'boolean' &&
    typeof v.decidedAt === 'number' &&
    v.version === CONSENT_VERSION
  );
}

export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidConsent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConsent(state: ConsentState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota); fall through to cookie.
  }
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  // Cookie carries only the booleans — enough for server-side gating if ever
  // needed without leaking the full record.
  const flag = `${state.analytics ? 'a' : '-'}${state.marketing ? 'm' : '-'}`;
  document.cookie = `${CONSENT_COOKIE_NAME}=${flag}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
}

export function clearConsent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // ignore
  }
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: null }));
}

export function buildConsent(analytics: boolean, marketing: boolean): ConsentState {
  return {
    necessary: true,
    analytics,
    marketing,
    decidedAt: Date.now(),
    version: CONSENT_VERSION,
  };
}
