/**
 * Leaderboard Service
 * Monthly GMA per-sport challenge — ranked by games played over the
 * canonical qualifying_played_game definition (get_sport_leaderboard RPC).
 */

import { getProfilePictureUrl } from '@rallia/shared-utils';

import { supabase } from '../supabase';

export interface SportLeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  games: number;
}

export interface SportLeaderboardPage {
  items: SportLeaderboardEntry[];
  /** Offset for the next page, or null when the last page has been reached. */
  nextOffset: number | null;
}

export interface MySportRank {
  rank: number;
  games: number;
}

/**
 * One page of the monthly GMA leaderboard for a sport. `month` = any ISO date
 * inside the target calendar month (defaults to the current month,
 * America/Toronto, server-side). Designed for infinite scroll via limit/offset.
 */
export async function getSportLeaderboardPage(params: {
  sportId: string;
  month?: string;
  limit: number;
  offset: number;
}): Promise<SportLeaderboardPage> {
  const { sportId, month, limit, offset } = params;
  const { data, error } = await supabase.rpc('get_sport_leaderboard', {
    p_sport_id: sportId,
    p_month: month,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('Error fetching sport leaderboard:', error);
    throw new Error(error.message);
  }

  const items: SportLeaderboardEntry[] = ((data as any[]) ?? []).map(row => ({
    rank: Number(row.rank),
    playerId: row.player_id,
    displayName: row.display_name,
    avatarUrl: getProfilePictureUrl(row.avatar_url) ?? null,
    games: Number(row.games),
  }));

  return { items, nextOffset: items.length === limit ? offset + items.length : null };
}

/**
 * The caller's own rank on the sport's monthly board — stays correct no matter
 * how far the leaderboard list has been paged. Returns null when the caller has
 * no qualifying games this month.
 */
export async function getMySportRank(params: {
  sportId: string;
  month?: string;
}): Promise<MySportRank | null> {
  const { sportId, month } = params;
  const { data, error } = await supabase.rpc('get_my_sport_rank', {
    p_sport_id: sportId,
    p_month: month,
  });

  if (error) {
    console.error('Error fetching my sport rank:', error);
    throw new Error(error.message);
  }

  const row = ((data as any[]) ?? [])[0];
  if (!row) return null;
  return {
    rank: Number(row.rank),
    games: Number(row.games),
  };
}
