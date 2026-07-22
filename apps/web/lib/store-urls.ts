import type { UtmParams } from '@rallia/shared-utils';

export const APP_STORE_URL = 'https://apps.apple.com/app/rallia/id6760482014';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp';

export type InvitationType =
  | 'referral'
  | 'match'
  | 'group'
  | 'community'
  | 'tournament'
  | 'flyer'
  | 'poster'
  | 'social';

/**
 * Build the Android Play Store URL with referrer parameters for the Install
 * Referrer API. `referralCode` is optional — non-referral invite links
 * (e.g. /join/{code}) don't have one. UTM and PostHog distinct_id are
 * passed through so the Android cold-launch can recover full attribution.
 *
 * Lives here (not referral-tracking.ts) so client components can import it
 * without pulling in the server-only Supabase service-role client.
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
      if (value) parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  if (parts.length === 0) return PLAY_STORE_URL;
  const referrerParam = encodeURIComponent(parts.join('&'));
  return `${PLAY_STORE_URL}&referrer=${referrerParam}`;
}
