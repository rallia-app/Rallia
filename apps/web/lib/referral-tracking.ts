/**
 * Shared referral tracking utilities for web landing pages.
 * Handles fingerprinting, click logging, platform detection,
 * and app store redirects with referrer parameters.
 */

import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

type InvitationType = 'referral' | 'match' | 'group' | 'community';

export function computeFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
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
    p_target_id: targetId ?? null,
  });
}

export async function logReferralFingerprint(
  code: string,
  fingerprint: string,
  ip: string,
  userAgent: string,
  invitationType: InvitationType = 'referral',
  targetId?: string
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.rpc('log_referral_fingerprint', {
    p_referral_code: code.toUpperCase(),
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_user_agent: userAgent,
    p_invitation_type: invitationType,
    p_target_id: targetId ?? null,
  });
}

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/idXXXXXXXXXX';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.rallia.app';

export { APP_STORE_URL, PLAY_STORE_URL };

/**
 * Build the Android Play Store URL with referrer parameters for Install Referrer API.
 */
export function buildPlayStoreUrl(
  referralCode: string,
  invitationType: InvitationType = 'referral',
  targetId?: string
): string {
  const parts = [`referral_code=${referralCode.toUpperCase()}`];
  if (invitationType !== 'referral') {
    parts.push(`invitation_type=${invitationType}`);
  }
  if (targetId) {
    parts.push(`target_id=${targetId}`);
  }
  const referrerParam = encodeURIComponent(parts.join('&'));
  return `${PLAY_STORE_URL}&referrer=${referrerParam}`;
}
