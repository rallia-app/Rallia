/**
 * Group Match Service
 * Operations for matches/games posted to groups, leaderboards
 */

import { supabase } from '../supabase';
import type { GroupMatch, LeaderboardEntry } from './groupTypes';
import { logGroupActivity } from './groupActivityService';

// ============================================================================
// MATCH QUERIES
// ============================================================================

/**
 * Get matches posted to a group
 */
export async function getGroupMatches(
  groupId: string,
  daysBack: number = 180,
  limit: number = 50
): Promise<GroupMatch[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const { data, error } = await supabase
    .from('match_network')
    .select(`
      id,
      match_id,
      network_id,
      posted_by,
      posted_at,
      match:match_id (
        id,
        sport_id,
        match_date,
        start_time,
        player_expectation,
        cancelled_at,
        format,
        created_by,
        sport:sport_id (
          id,
          name,
          icon_url
        ),
        participants:match_participant (
          id,
          player_id,
          team_number,
          is_host,
          player:player_id (
            id,
            profile:profile!inner (
              first_name,
              last_name,
              display_name,
              profile_picture_url
            )
          )
        ),
        result:match_result (
          id,
          winning_team,
          team1_score,
          team2_score,
          is_verified,
          sets:match_set (
            id,
            set_number,
            team1_score,
            team2_score
          )
        )
      ),
      posted_by_player:posted_by (
        id,
        profile:profile!inner (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `)
    .eq('network_id', groupId)
    .gte('posted_at', cutoffDate.toISOString())
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching group matches:', error);
    throw new Error(error.message);
  }

  // Transform the data to handle Supabase's nested response format
  return (data || []).map((item: Record<string, unknown>) => {
    const match = item.match as Record<string, unknown> | null;
    const postedByPlayer = item.posted_by_player as Record<string, unknown> | null;
    
    // Handle result transformation with sets
    const transformResult = (resultData: unknown): GroupMatch['match']['result'] => {
      const result = Array.isArray(resultData) && resultData.length > 0 
        ? resultData[0] as Record<string, unknown>
        : resultData as Record<string, unknown> | null;
      
      if (!result) return null;
      
      // Get sets and sort by set_number
      const setsData = result.sets as Array<Record<string, unknown>> | undefined;
      const sets = setsData 
        ? setsData
            .map(s => ({
              id: s.id as string,
              set_number: s.set_number as number,
              team1_score: s.team1_score as number,
              team2_score: s.team2_score as number,
            }))
            .sort((a, b) => a.set_number - b.set_number)
        : undefined;
      
      return {
        id: result.id as string,
        winning_team: result.winning_team as number | null,
        team1_score: result.team1_score as number | null,
        team2_score: result.team2_score as number | null,
        is_verified: result.is_verified as boolean,
        sets,
      };
    };
    
    return {
      id: item.id as string,
      match_id: item.match_id as string,
      network_id: item.network_id as string,
      posted_by: item.posted_by as string,
      posted_at: item.posted_at as string,
      match: match ? {
        id: match.id as string,
        sport_id: match.sport_id as string,
        match_date: match.match_date as string,
        start_time: match.start_time as string,
        player_expectation: match.player_expectation as 'practice' | 'competitive' | 'both',
        cancelled_at: (match.cancelled_at as string) || null,
        format: match.format as 'singles' | 'doubles',
        created_by: match.created_by as string,
        sport: match.sport as GroupMatch['match']['sport'],
        participants: (match.participants as Array<Record<string, unknown>> || []).map(p => ({
          id: p.id as string,
          player_id: p.player_id as string,
          team_number: p.team_number as number | null,
          is_host: p.is_host as boolean,
          player: p.player as GroupMatch['match']['participants'][0]['player'],
        })),
        result: transformResult(match.result),
      } : undefined,
      posted_by_player: postedByPlayer as GroupMatch['posted_by_player'],
    } as GroupMatch;
  }).filter((item: GroupMatch) => item.match !== undefined);
}

/**
 * Get the most recent match posted to a group
 */
export async function getMostRecentGroupMatch(
  groupId: string
): Promise<GroupMatch | null> {
  const matches = await getGroupMatches(groupId, 180, 1);
  return matches.length > 0 ? matches[0] : null;
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Get leaderboard for a group based on games played
 */
export async function getGroupLeaderboard(
  groupId: string,
  daysBack: number = 30
): Promise<LeaderboardEntry[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  // First get all matches posted to this group within the time period
  const { data: matchNetworks, error: mnError } = await supabase
    .from('match_network')
    .select('match_id')
    .eq('network_id', groupId)
    .gte('posted_at', cutoffDate.toISOString());

  if (mnError) {
    console.error('Error fetching match networks:', mnError);
    throw new Error(mnError.message);
  }

  if (!matchNetworks || matchNetworks.length === 0) {
    return [];
  }

  const matchIds = matchNetworks.map(mn => mn.match_id);

  // Get all participants and results for these matches (only verified scores)
  const { data: participants, error: pError } = await supabase
    .from('match_participant')
    .select(`
      player_id,
      team_number,
      match:match_id (
        id,
        result:match_result (
          winning_team,
          is_verified,
          confirmation_deadline
        )
      ),
      player:player_id (
        id,
        profile:profile!inner (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `)
    .in('match_id', matchIds);

  if (pError) {
    console.error('Error fetching participants:', pError);
    throw new Error(pError.message);
  }

  // Aggregate by player (only count verified scores or auto-confirmed after deadline)
  const leaderboardMap = new Map<string, LeaderboardEntry>();
  const now = new Date();

  for (const p of participants || []) {
    const playerId = p.player_id;
    // Handle Supabase nested response - match can be array or object
    const matchData = Array.isArray(p.match) ? p.match[0] : p.match;
    const resultData = matchData?.result;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    
    // Skip if no result or if not verified and deadline hasn't passed
    if (!result) continue;
    
    const isVerified = result.is_verified as boolean;
    const confirmationDeadline = result.confirmation_deadline 
      ? new Date(result.confirmation_deadline as string) 
      : null;
    const deadlinePassed = confirmationDeadline ? now > confirmationDeadline : true;
    
    // Only count if verified OR deadline has passed (auto-confirmed)
    if (!isVerified && !deadlinePassed) continue;
    
    const winningTeam = result.winning_team as number | null;
    const isWinner = winningTeam !== null && p.team_number === winningTeam;

    // Handle player data similarly
    const playerData = Array.isArray(p.player) ? p.player[0] : p.player;
    const profileData = playerData?.profile;
    const profile = Array.isArray(profileData) ? profileData[0] : profileData;

    if (!leaderboardMap.has(playerId)) {
      leaderboardMap.set(playerId, {
        player_id: playerId,
        games_played: 0,
        games_won: 0,
        player: playerData ? {
          id: playerData.id as string,
          profile: profile ? {
            first_name: profile.first_name as string,
            last_name: profile.last_name as string | null,
            display_name: profile.display_name as string | null,
            profile_picture_url: profile.profile_picture_url as string | null,
          } : undefined,
        } : undefined,
      });
    }

    const entry = leaderboardMap.get(playerId)!;
    entry.games_played += 1;
    if (isWinner) {
      entry.games_won += 1;
    }
  }

  // Convert to array and sort by games played (descending)
  return Array.from(leaderboardMap.values())
    .sort((a, b) => b.games_played - a.games_played);
}

// ============================================================================
// MATCH POSTING
// ============================================================================

/**
 * Post a match to a group
 */
export async function postMatchToGroup(
  matchId: string,
  groupId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('match_network')
    .insert({
      match_id: matchId,
      network_id: groupId,
      posted_by: playerId,
    });

  if (error) {
    // Check if it's a duplicate
    if (error.code === '23505') {
      throw new Error('This match has already been posted to this group');
    }
    console.error('Error posting match to group:', error);
    throw new Error(error.message);
  }

  // Log activity
  await logGroupActivity(groupId, 'game_created', playerId, matchId, {
    match_id: matchId,
  });
}

/**
 * Remove a match from a group
 */
export async function removeMatchFromGroup(
  matchId: string,
  groupId: string
): Promise<void> {
  const { error } = await supabase
    .from('match_network')
    .delete()
    .eq('match_id', matchId)
    .eq('network_id', groupId);

  if (error) {
    console.error('Error removing match from group:', error);
    throw new Error(error.message);
  }
}
