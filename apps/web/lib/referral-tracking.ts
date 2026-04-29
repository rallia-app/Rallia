/**
 * Shared referral tracking utilities for web landing pages.
 * Handles fingerprinting, click logging, platform detection,
 * and app store redirects with referrer parameters.
 */

import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

type InvitationType = 'referral' | 'match' | 'group' | 'community' | 'flyer' | 'poster';

/**
 * Extract stable device traits from any iOS user agent string.
 * Both Safari and WKWebView include "CPU iPhone OS XX_X like Mac OS X",
 * so we use that as the stable device signature for fingerprinting.
 * Falls back to the full user agent if the pattern doesn't match.
 */
function extractStableDeviceTraits(userAgent: string): string {
  // Matches e.g. "iPhone; CPU iPhone OS 19_0 like Mac OS X"
  const match = userAgent.match(/(iPhone|iPad|iPod);[^)]+like Mac OS X/);
  return match ? match[0] : userAgent;
}

/**
 * Extract the iOS build number from a user agent string.
 * Both Safari and WKWebView UAs contain "Mobile/XXXXX" where XXXXX is the
 * build number (e.g. "15E148"). This is more granular than the OS version
 * alone and is consistent across Safari and WKWebView on the same device.
 */
function extractBuildNumber(userAgent: string): string {
  const match = userAgent.match(/Mobile\/(\w+)/);
  return match ? match[1] : '';
}

/**
 * Extract the primary locale from the Accept-Language header.
 * Returns the first language tag (e.g. "fr-CA" from "fr-CA,fr;q=0.9,en;q=0.8").
 * This matches the device's primary locale reported by expo-localization.
 */
function extractPrimaryLocale(acceptLanguage: string): string {
  // First entry before any comma or semicolon
  const primary = acceptLanguage.split(/[,;]/)[0]?.trim();
  return primary || '';
}

/**
 * Compute a device fingerprint from device traits, build number, and locale.
 * IP is NOT included because iCloud Private Relay (enabled by default for
 * iCloud+ subscribers on iOS 15+) routes Safari traffic through Apple relay
 * servers, giving the web server a different IP than the mobile app sees.
 *
 * The combination of device traits + build number + locale provides ~18,000+
 * distinct fingerprints, sufficient for deferred deep link matching within
 * a 7-day window at current scale.
 *
 * IP is still stored separately in the DB and used as a preference tiebreaker.
 */
export function computeFingerprint(
  _ip: string,
  userAgent: string,
  acceptLanguage?: string
): string {
  const traits = extractStableDeviceTraits(userAgent);
  const build = extractBuildNumber(userAgent);
  const locale = acceptLanguage ? extractPrimaryLocale(acceptLanguage) : '';
  return createHash('sha256').update(`${traits}:${build}:${locale}`).digest('hex');
}

export function detectPlatform(userAgent: string): 'ios' | 'android' | null {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return null;
}

export async function logReferralClick(
  code: string,
  fingerprint: string,
  ip: string,
  userAgent: string,
  invitationType: InvitationType = 'referral',
  targetId?: string
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.rpc('log_referral_click', {
    p_referral_code: code.toUpperCase(),
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_user_agent: userAgent,
    p_invitation_type: invitationType,
    p_target_id: targetId,
  });
}

import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';
export { APP_STORE_URL, PLAY_STORE_URL };

/**
 * Build the Android Play Store URL with referrer parameters for Install Referrer API.
 * `referralCode` is optional — non-referral invite links (e.g. /join/{code}) don't have one.
 */
export function buildPlayStoreUrl(
  referralCode?: string,
  invitationType: InvitationType = 'referral',
  targetId?: string
): string {
  const parts: string[] = [];
  if (referralCode) {
    parts.push(`referral_code=${referralCode.toUpperCase()}`);
  }
  if (invitationType !== 'referral') {
    parts.push(`invitation_type=${invitationType}`);
  }
  if (targetId) {
    parts.push(`target_id=${targetId}`);
  }
  if (parts.length === 0) return PLAY_STORE_URL;
  const referrerParam = encodeURIComponent(parts.join('&'));
  return `${PLAY_STORE_URL}&referrer=${referrerParam}`;
}
