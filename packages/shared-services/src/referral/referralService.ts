/**
 * Referral Service
 * Player referral operations: code generation, invite tracking, attribution
 */

import { supabase } from '../supabase';

// ============================================================================
// TYPES
// ============================================================================

export type ReferralChannel = 'sms' | 'email' | 'share_sheet' | 'copy_link' | 'qr_code' | 'contacts';

export interface ReferralStats {
  total_invited: number;
  total_converted: number;
}

export interface ReferralInvite {
  id: string;
  referrer_id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  channel: ReferralChannel;
  status: 'sent' | 'clicked' | 'signed_up';
  converted_player_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordReferralInvitesInput {
  referrerId: string;
  channel: ReferralChannel;
  contacts: Array<{
    name?: string;
    phone?: string;
    email?: string;
  }>;
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
  return `https://rallia.app/invite/${referralCode}`;
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
// INVITE TRACKING
// ============================================================================

/**
 * Record referral invites (bulk insert into referral_invite table)
 */
export async function recordReferralInvites(
  input: RecordReferralInvitesInput
): Promise<ReferralInvite[]> {
  const rows = input.contacts.map((contact) => ({
    referrer_id: input.referrerId,
    recipient_name: contact.name || null,
    recipient_phone: contact.phone || null,
    recipient_email: contact.email || null,
    channel: input.channel,
    status: 'sent',
  }));

  const { data, error } = await supabase
    .from('referral_invite')
    .insert(rows)
    .select();

  if (error) {
    console.error('Error recording referral invites:', error);
    throw new Error(error.message);
  }

  return data as ReferralInvite[];
}

// ============================================================================
// ATTRIBUTION
// ============================================================================

/**
 * Attribute a referral when a new player signs up
 */
export async function attributeReferral(
  referralCode: string,
  newPlayerId: string
): Promise<{ success: boolean; referrerId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('attribute_referral', {
    p_referral_code: referralCode.toUpperCase(),
    p_new_player_id: newPlayerId,
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
