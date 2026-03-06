/**
 * Referral Service
 * Player referral operations: code generation, click tracking, attribution
 */

import { supabase } from '../supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface ReferralStats {
  total_clicked: number;
  total_converted: number;
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
 * Get the referral link URL for a code
 */
export function getReferralLink(referralCode: string): string {
  const baseUrl = process.env.EXPO_PUBLIC_WEB_URL || 'https://rallia.app';
  return `${baseUrl}/invite/${referralCode}`;
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
 * Match a device fingerprint to find a pending referral code
 */
export async function matchReferralFingerprint(
  fingerprint: string,
  ip: string,
  playerId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('match_referral_fingerprint', {
    p_device_fingerprint: fingerprint,
    p_ip_address: ip,
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error matching referral fingerprint:', error);
    throw new Error(error.message);
  }

  return data as string | null;
}

// ============================================================================
// ATTRIBUTION
// ============================================================================

/**
 * Attribute a referral when a new player signs up
 */
export async function attributeReferral(
  referralCode: string,
  newPlayerId: string,
  newPlayerEmail?: string
): Promise<{ success: boolean; referrerId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('attribute_referral', {
    p_referral_code: referralCode.toUpperCase(),
    p_new_player_id: newPlayerId,
    p_new_player_email: newPlayerEmail ?? null,
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
