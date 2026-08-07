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
import type { InvitationType } from '@/lib/store-urls';

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

// buildPlayStoreUrl moved to store-urls.ts (client-safe); re-exported here
// so existing server-side callers keep working.
export { APP_STORE_URL, PLAY_STORE_URL, buildPlayStoreUrl, detectPlatform } from '@/lib/store-urls';
