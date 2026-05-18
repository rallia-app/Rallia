/**
 * Shared landing page attribution utilities.
 *
 * Reads request headers + first-party cookies and returns the full inbound
 * attribution context any server-side landing page needs to call
 * `logReferralClick`. The PostHog distinct_id and UTM cookie are written
 * client-side by `UtmCapture`; they may be absent on the very first hit
 * (server runs before the client-side capture effect), which is fine —
 * subsequent visits to deep-link landings will carry them.
 *
 * URL UTM params are layered on top of the cookie as "current touch": the
 * cookie persists the first-touch UTMs, but the click being logged right
 * now reflects whatever the URL says.
 */

import { cookies, headers } from 'next/headers';
import type { UtmParams } from '@rallia/shared-utils';

import { detectPlatform } from '@/lib/referral-tracking';

export interface LandingContext {
  platform: 'ios' | 'android' | null;
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  webDistinctId: string | undefined;
  utm: (UtmParams & { referrer_host?: string }) | undefined;
}

const UTM_COOKIE_NAME = 'rallia_utm';
const DID_COOKIE_NAME = 'ph_did';
const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const satisfies ReadonlyArray<keyof UtmParams>;

/**
 * Picks the canonical UTM subset out of an Next.js searchParams-like object.
 * Accepts `unknown` so callers can pass their `await searchParams` value
 * directly without TypeScript gymnastics — each page declares its own typed
 * shape for the params, and the runtime check tolerates missing keys.
 */
function pickUrlUtm(searchParams: unknown): UtmParams | undefined {
  if (!searchParams || typeof searchParams !== 'object') return undefined;
  const record = searchParams as Record<string, unknown>;
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const raw: unknown = record[key];
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function getLandingContext(searchParams?: unknown): Promise<LandingContext> {
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const acceptLanguage = headersList.get('accept-language') ?? '';

  const cookieStore = await cookies();
  const webDistinctId = cookieStore.get(DID_COOKIE_NAME)?.value || undefined;
  const utmRaw = cookieStore.get(UTM_COOKIE_NAME)?.value;

  let utm: LandingContext['utm'];
  if (utmRaw) {
    try {
      const decoded = decodeURIComponent(utmRaw);
      const parsed = JSON.parse(decoded) as UtmParams & { referrer_host?: string };
      if (parsed && typeof parsed === 'object') utm = parsed;
    } catch {
      // Malformed cookie — drop silently and continue without UTM context.
    }
  }

  // Current-touch from the URL wins over the first-touch cookie. The cookie
  // also won't be populated on the very first visit (UtmCapture writes it
  // client-side, after SSR), so URL params are the only signal that round.
  const urlUtm = pickUrlUtm(searchParams);
  if (urlUtm) {
    utm = { ...(utm ?? {}), ...urlUtm };
  }

  return {
    platform: detectPlatform(userAgent),
    ip,
    userAgent,
    acceptLanguage,
    webDistinctId,
    utm,
  };
}
