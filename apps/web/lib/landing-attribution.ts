/**
 * Shared landing page attribution utilities.
 *
 * Extracts request context (user agent, IP, fingerprint, platform) from
 * server component headers and provides a single function for all landing
 * pages to call, avoiding duplicated header-reading logic.
 */

import { headers } from 'next/headers';
import { computeFingerprint, detectPlatform } from '@/lib/referral-tracking';

export interface LandingContext {
  platform: 'ios' | 'android' | null;
  fingerprint: string;
  ip: string;
  userAgent: string;
  acceptLanguage: string;
}

/**
 * Read request headers and compute attribution context for any landing page.
 * Call this at the top of a server component to get platform + fingerprint data.
 */
export async function getLandingContext(): Promise<LandingContext> {
  const headersList = await headers();
  const userAgent = headersList.get('user-agent') ?? '';
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const acceptLanguage = headersList.get('accept-language') ?? '';

  const fingerprint = computeFingerprint(ip, userAgent, acceptLanguage);
  const platform = detectPlatform(userAgent);

  return { platform, fingerprint, ip, userAgent, acceptLanguage };
}
