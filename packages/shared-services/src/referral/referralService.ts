/**
 * Referral Service
 * Player referral operations: code generation, click tracking, attribution
 */

import { getProfilePictureUrl } from '@rallia/shared-utils';

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

export interface ReferralContest {
  id: string;
  title: string;
  prizeDescription: string;
  titleEn: string | null;
  titleFr: string | null;
  prizeDescriptionEn: string | null;
  prizeDescriptionFr: string | null;
  startAt: string;
  endAt: string;
  maxWinners: number;
}

/**
 * Returns a copy of the contest with title/prizeDescription set to the
 * locale-appropriate value, falling back through EN then the base field.
 */
export function localizeContest(contest: ReferralContest, locale: string): ReferralContest {
  const isFr = locale.startsWith('fr');
  return {
    ...contest,
    title: (isFr ? contest.titleFr : contest.titleEn) ?? contest.titleEn ?? contest.title,
    prizeDescription:
      (isFr ? contest.prizeDescriptionFr : contest.prizeDescriptionEn) ??
      contest.prizeDescriptionEn ??
      contest.prizeDescription,
  };
}

export interface ReferralLeaderboardEntry {
  referrerId: string;
  displayName: string;
  avatarUrl: string | null;
  referralCount: number;
  rank: number;
}

export interface ContestRank {
  rank: number;
  referralCount: number;
  totalParticipants: number;
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
// CONTEST
// ============================================================================

/**
 * Returns the currently active contest, or null if none is running.
 */
export async function getActiveContest(): Promise<ReferralContest | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('referral_contest')
    .select(
      'id, title, prize_description, title_en, title_fr, prize_description_en, prize_description_fr, start_at, end_at, max_winners'
    )
    .eq('is_active', true)
    .lte('start_at', now)
    .gte('end_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching active contest:', error);
    throw new Error(error.message);
  }
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    prizeDescription: data.prize_description,
    titleEn: data.title_en ?? null,
    titleFr: data.title_fr ?? null,
    prizeDescriptionEn: data.prize_description_en ?? null,
    prizeDescriptionFr: data.prize_description_fr ?? null,
    startAt: data.start_at,
    endAt: data.end_at,
    maxWinners: data.max_winners,
  };
}

/**
 * Returns the leaderboard for a contest (top p_limit referrers).
 */
export async function getReferralLeaderboard(
  contestId: string,
  limit = 10
): Promise<ReferralLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_referral_leaderboard', {
    p_contest_id: contestId,
    p_limit: limit,
  });

  if (error) {
    console.error('Error fetching referral leaderboard:', error);
    throw new Error(error.message);
  }

  return ((data as any[]) ?? []).map(row => ({
    referrerId: row.referrer_id,
    displayName: row.display_name,
    avatarUrl: getProfilePictureUrl(row.avatar_url) ?? null,
    referralCount: Number(row.referral_count),
    rank: Number(row.rank),
  }));
}

/**
 * Returns the calling player's rank within the contest.
 */
export async function getMyContestRank(contestId: string, playerId: string): Promise<ContestRank> {
  const { data, error } = await supabase.rpc('get_my_contest_rank', {
    p_contest_id: contestId,
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error fetching contest rank:', error);
    throw new Error(error.message);
  }

  const result = data as { rank: number; referral_count: number; total_participants: number };
  return {
    rank: result.rank,
    referralCount: result.referral_count,
    totalParticipants: result.total_participants,
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
