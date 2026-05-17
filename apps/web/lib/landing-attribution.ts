/**
 * Shared landing page attribution utilities.
 *
 * Reads request headers + first-party cookies and returns the full inbound
 * attribution context any server-side landing page needs to call
 * `logReferralClick`. The PostHog distinct_id and UTM cookie are written
 * client-side by `UtmCapture`; they may be absent on the very first hit
 * (server runs before the client-side capture effect), which is fine —
 * subsequent visits to deep-link landings will carry them.
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

export async function getLandingContext(): Promise<LandingContext> {
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

  return {
    platform: detectPlatform(userAgent),
    ip,
    userAgent,
    acceptLanguage,
    webDistinctId,
    utm,
  };
}
