/**
 * Shared referral tracking utilities for web landing pages.
 *
 * Handles server-side click logging (writes to `referral_link_click` via the
 * `log_referral_click` RPC), platform detection, and Play Store URL building
 * with install-referrer payloads.
 *
 * Note: device fingerprinting was removed in favour of PostHog distinct_id
 * passthrough — fingerprint matching was unreliable on iOS (iCloud Private
 * Relay) and is explicitly forbidden by Apple's App Review Guidelines.
 * `log_referral_click`'s `device_fingerprint` column is kept in the schema
 * for back-compat but is written as an empty string.
 */

import type { UtmParams } from '@rallia/shared-utils';

import { createServiceRoleClient } from '@/lib/supabase/server';

type InvitationType =
  | 'referral'
  | 'match'
  | 'group'
  | 'community'
  | 'tournament'
  | 'flyer'
  | 'poster'
  | 'social';

export function detectPlatform(userAgent: string): 'ios' | 'android' | null {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return null;
}

export async function logReferralClick(
  code: string,
  ip: string,
  userAgent: string,
  invitationType: InvitationType = 'referral',
  targetId?: string,
  webDistinctId?: string,
  utm?: UtmParams & { referrer_host?: string }
): Promise<void> {
  const supabase = createServiceRoleClient();
  // The RPC signature kept `p_device_fingerprint` for back-compat; we pass
  // an empty string since the fingerprint code path is gone. The RPC's
  // ON CONFLICT key still includes device_fingerprint, so passing '' means
  // each (referral_code, invitation_type) tuple dedupes to a single row —
  // good enough for click counting.
  await supabase.rpc('log_referral_click', {
    p_referral_code: code.toUpperCase(),
    p_device_fingerprint: '',
    p_ip_address: ip,
    p_user_agent: userAgent,
    p_invitation_type: invitationType,
    p_target_id: targetId,
    p_web_distinct_id: webDistinctId ?? undefined,
    p_utm: utm ? (utm as Record<string, string>) : undefined,
  });
}

import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-urls';
export { APP_STORE_URL, PLAY_STORE_URL };

/**
 * Build the Android Play Store URL with referrer parameters for the Install
 * Referrer API. `referralCode` is optional — non-referral invite links
 * (e.g. /join/{code}) don't have one. UTM and PostHog distinct_id are
 * passed through so the Android cold-launch can recover full attribution.
 */
export function buildPlayStoreUrl(
  referralCode?: string,
  invitationType: InvitationType = 'referral',
  targetId?: string,
  extras?: { webDistinctId?: string; utm?: UtmParams }
): string {
  const parts: string[] = [];
  if (referralCode) parts.push(`referral_code=${referralCode.toUpperCase()}`);
  if (invitationType !== 'referral') parts.push(`invitation_type=${invitationType}`);
  if (targetId) parts.push(`target_id=${targetId}`);
  if (extras?.webDistinctId) parts.push(`ph_did=${encodeURIComponent(extras.webDistinctId)}`);
  if (extras?.utm) {
    for (const [key, value] of Object.entries(extras.utm)) {
      if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  if (parts.length === 0) return PLAY_STORE_URL;
  const referrerParam = encodeURIComponent(parts.join('&'));
  return `${PLAY_STORE_URL}&referrer=${referrerParam}`;
}
