/**
 * Referral Service
 * Player referral operations: code generation, click tracking, attribution
 */

import { supabase } from '../supabase';
import { generateInvitationLink } from '../invitation/invitationLinkService';
import type { InvitationType } from '../invitation/invitationLinkService';

// ============================================================================
// TYPES
// ============================================================================

export interface ReferralStats {
  total_clicked: number;
  total_converted: number;
}

export interface FingerprintMatchResult {
  code: string;
  invitation_type: InvitationType;
  target_id?: string;
}

// ============================================================================
// REFERRAL CODE OPERATIONS
// ============================================================================

/**
 * Get or create a referral code for a player
 */
export async function getOrCreateReferralCode(playerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_player_referral_code', {
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error getting/creating referral code:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Get the referral link URL for a code (pure referral, no target)
 */
export function getReferralLink(referralCode: string): string {
  return generateInvitationLink({ type: 'referral', referralCode });
}

// ============================================================================
// STATS
// ============================================================================

/**
 * Get referral stats for a player
 */
export async function getReferralStats(playerId: string): Promise<ReferralStats> {
  const { data, error } = await supabase.rpc('get_player_referral_stats', {
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error getting referral stats:', error);
    throw new Error(error.message);
  }

  return data as ReferralStats;
}

// ============================================================================
// FINGERPRINT MATCHING (iOS deferred deep link)
// ============================================================================

/**
 * Match a device fingerprint to find a pending referral.
 * Returns structured data with the code, invitation type, and target ID.
 */
export async function matchReferralFingerprint(
  fingerprint: string,
  ip: string,
  playerId: string
): Promise<FingerprintMatchResult | null> {
  const { data, error } = await supabase.rpc('match_referral_fingerprint', {
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error matching referral fingerprint:', error);
    throw new Error(error.message);
  }

  if (!data) return null;

  const result = data as { code: string; invitation_type: string; target_id?: string };
  return {
    code: result.code,
    invitation_type: (result.invitation_type || 'referral') as InvitationType,
    target_id: result.target_id ?? undefined,
  };
}

// ============================================================================
// ATTRIBUTION
// ============================================================================

/**
 * Attribute a referral when a new player signs up.
 * Accepts optional invitation type and target ID for tracking.
 */
export async function attributeReferral(
  referralCode: string,
  newPlayerId: string,
  newPlayerEmail?: string,
  invitationType?: InvitationType,
  targetId?: string
): Promise<{ success: boolean; referrerId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('attribute_referral', {
    p_referral_code: referralCode.toUpperCase(),
    p_new_player_id: newPlayerId,
    p_new_player_email: newPlayerEmail ?? null,
    p_invitation_type: invitationType ?? 'referral',
    p_target_id: targetId ?? null,
  });

  if (error) {
    console.error('Error attributing referral:', error);
    throw new Error(error.message);
  }

  const result = data as { success: boolean; referrer_id?: string; error?: string };

  return {
    success: result.success,
    referrerId: result.referrer_id,
    error: result.error,
  };
}
