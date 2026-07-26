/**
 * Tournament Ranking Service ("Points Rallia")
 * Season-based tournament achievement board — points earned by entering and
 * advancing in tournaments (get_tournament_leaderboard / get_my_tournament_ranking).
 * Separate currency from the monthly challenge (see leaderboardService).
 */

import { getProfilePictureUrl } from '@rallia/shared-utils';

import { supabase } from '../supabase';

export type RankingLevelFilter = 'beginner' | 'intermediate' | 'advanced';

export interface TournamentRankingEntry {
  rank: number;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  points: number;
  eventsPlayed: number;
}

export interface TournamentRankingPage {
  items: TournamentRankingEntry[];
  /** Offset for the next page, or null when the last page has been reached. */
  nextOffset: number | null;
}

export interface MyTournamentRanking {
  sportId: string;
  rank: number;
  points: number;
  eventsPlayed: number;
  /** Bucket of the caller's latest result — drives the "my level" filter; null when unrated. */
  levelBucket: RankingLevelFilter | null;
}

export interface PointsToDefendRow {
  ledgerId: string;
  tournamentId: string;
  tournamentName: string;
  sportId: string;
  placement: string;
  points: number;
  /**
   * The result is currently inside the player's best 8 for the sport, i.e. its
   * expiry will actually move their total. A false row is not being defended.
   */
  countsNow: boolean;
  earnedAt: string;
  expiresAt: string;
  daysRemaining: number;
}

/**
 * One page of the Circuit-Rallia board for a sport + season. `seasonCode`
 * (e.g. "2026-SS") defaults server-side to the current season. `levelFilter`
 * narrows to players whose latest result is at that level bucket ("my level"
 * view); `ratingScoreFilter` narrows to players whose CURRENT active rating is
 * that exact rating_score (by id, "my rating" view). Omit both for the common
 * board. Designed for infinite scroll via limit/offset.
 */
export async function getTournamentRankingPage(params: {
  sportId: string;
  seasonCode?: string;
  levelFilter?: RankingLevelFilter;
  ratingScoreFilter?: string;
  limit: number;
  offset: number;
}): Promise<TournamentRankingPage> {
  const { sportId, seasonCode, levelFilter, ratingScoreFilter, limit, offset } = params;
  const { data, error } = await supabase.rpc('get_tournament_leaderboard', {
    p_sport_id: sportId,
    p_season_code: seasonCode,
    p_level_filter: levelFilter,
    p_rating_score_id: ratingScoreFilter,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('Error fetching tournament ranking:', error);
    throw new Error(error.message);
  }

  const items: TournamentRankingEntry[] = ((data as any[]) ?? []).map(row => ({
    rank: Number(row.rank),
    userId: row.user_id,
    fullName: row.full_name,
    avatarUrl: getProfilePictureUrl(row.avatar_url) ?? null,
    points: Number(row.points),
    eventsPlayed: Number(row.events_played),
  }));

  return { items, nextOffset: items.length === limit ? offset + items.length : null };
}

/**
 * The caller's own standing on the common (unfiltered) board for every sport
 * they appear on in the season — stays correct no matter how far the list is
 * paged. Empty array when the caller has no points this season.
 */
export async function getMyTournamentRanking(params: {
  seasonCode?: string;
}): Promise<MyTournamentRanking[]> {
  const { seasonCode } = params;
  const { data, error } = await supabase.rpc('get_my_tournament_ranking', {
    p_season_code: seasonCode,
  });

  if (error) {
    console.error('Error fetching my tournament ranking:', error);
    throw new Error(error.message);
  }

  return ((data as any[]) ?? []).map(row => ({
    sportId: row.sport_id,
    rank: Number(row.rank),
    points: Number(row.points),
    eventsPlayed: Number(row.events_played),
    levelBucket: (row.level_bucket as RankingLevelFilter | null) ?? null,
  }));
}

/**
 * The caller's results that still count but expire within `withinDays`
 * (default 60 server-side), soonest first, across every sport they appear on.
 * Results already past the rolling window are gone rather than expiring and
 * are never returned. Callers should lead with `countsNow` rows: a result
 * outside the player's best 8 costs nothing when it expires.
 */
export async function getMyPointsToDefend(params: {
  withinDays?: number;
}): Promise<PointsToDefendRow[]> {
  const { withinDays } = params;
  const { data, error } = await supabase.rpc('get_my_points_to_defend', {
    p_within_days: withinDays,
  });

  if (error) {
    console.error('Error fetching points to defend:', error);
    throw new Error(error.message);
  }

  return ((data as any[]) ?? []).map(row => ({
    ledgerId: row.ledger_id,
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    sportId: row.sport_id,
    placement: row.placement,
    points: Number(row.points),
    countsNow: !!row.counts_now,
    earnedAt: row.earned_at,
    expiresAt: row.expires_at,
    daysRemaining: Number(row.days_remaining),
  }));
}
