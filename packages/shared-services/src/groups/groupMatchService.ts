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
    .select(
      `
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
    `
    )
    .eq('network_id', groupId)
    .gte('posted_at', cutoffDate.toISOString())
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching group matches:', error);
    throw new Error(error.message);
  }

  // Transform the data to handle Supabase's nested response format
  return (data || [])
    .map((item: Record<string, unknown>) => {
      const match = item.match as Record<string, unknown> | null;
      const postedByPlayer = item.posted_by_player as Record<string, unknown> | null;

      // Handle result transformation with sets
      const transformResult = (resultData: unknown): GroupMatch['match']['result'] => {
        const result =
          Array.isArray(resultData) && resultData.length > 0
            ? (resultData[0] as Record<string, unknown>)
            : (resultData as Record<string, unknown> | null);

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
        match: match
          ? {
              id: match.id as string,
              sport_id: match.sport_id as string,
              match_date: match.match_date as string,
              start_time: match.start_time as string,
              player_expectation: match.player_expectation as 'practice' | 'competitive' | 'both',
              cancelled_at: (match.cancelled_at as string) || null,
              format: match.format as 'singles' | 'doubles',
              created_by: match.created_by as string,
              sport: match.sport as GroupMatch['match']['sport'],
              participants: ((match.participants as Array<Record<string, unknown>>) || []).map(
                p => ({
                  id: p.id as string,
                  player_id: p.player_id as string,
                  team_number: p.team_number as number | null,
                  is_host: p.is_host as boolean,
                  player: p.player as GroupMatch['match']['participants'][0]['player'],
                })
              ),
              result: transformResult(match.result),
            }
          : undefined,
        posted_by_player: postedByPlayer as GroupMatch['posted_by_player'],
      } as GroupMatch;
    })
    .filter((item: GroupMatch) => item.match !== undefined);
}

/**
 * Get the most recent match posted to a group
 */
export async function getMostRecentGroupMatch(groupId: string): Promise<GroupMatch | null> {
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
    .select(
      `
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
    `
    )
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
        player: playerData
          ? {
              id: playerData.id as string,
              profile: profile
                ? {
                    first_name: profile.first_name as string,
                    last_name: profile.last_name as string | null,
                    display_name: profile.display_name as string | null,
                    profile_picture_url: profile.profile_picture_url as string | null,
                  }
                : undefined,
            }
          : undefined,
      });
    }

    const entry = leaderboardMap.get(playerId)!;
    entry.games_played += 1;
    if (isWinner) {
      entry.games_won += 1;
    }
  }

  // Convert to array and sort by games played (descending)
  return Array.from(leaderboardMap.values()).sort((a, b) => b.games_played - a.games_played);
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
  const { error } = await supabase.from('match_network').insert({
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
export async function removeMatchFromGroup(matchId: string, groupId: string): Promise<void> {
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

// ============================================================================
// NETWORK MEMBER UPCOMING MATCHES
// ============================================================================

/**
 * Match data returned from network member upcoming matches query
 */
export interface NetworkMemberMatch {
  id: string;
  sport_id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: 'singles' | 'doubles';
  player_expectation: 'practice' | 'competitive' | 'both';
  visibility: 'public' | 'private';
  join_mode: 'direct' | 'request';
  location_type: 'facility' | 'custom' | 'tbd';
  location_name: string | null;
  facility_id: string | null;
  created_by: string;
  cancelled_at: string | null;
  // Computed fields for display
  max_players: number;
  current_players: number;
  creator?: {
    first_name: string;
    last_name: string | null;
    profile_picture_url: string | null;
  };
  sport?: {
    id: string;
    name: string;
    display_name: string;
    icon_url: string | null;
  };
  facility?: {
    id: string;
    name: string;
    city: string | null;
    address: string | null;
  };
  participants: Array<{
    id: string;
    player_id: string;
    team_number: number | null;
    is_host: boolean;
    status: string;
    player?: {
      id: string;
      profile?: {
        first_name: string;
        last_name: string | null;
        display_name: string | null;
        profile_picture_url: string | null;
      };
    };
  }>;
  created_by_player?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    };
  };
}

/**
 * Get upcoming public matches of network members.
 * Returns matches where a network member is either the creator or a participant.
 * Filters by visibility settings and optionally by sport.
 *
 * @param networkId - The network (community or group) ID
 * @param networkType - 'community' or 'group' for proper visibility filtering
 * @param sportId - Optional sport ID to filter (null = all sports)
 * @param excludePlayerId - Player ID to exclude from results (current user)
 * @param limit - Maximum matches to return (default 20)
 */
export async function getNetworkMemberUpcomingMatches(
  networkId: string,
  networkType: 'community' | 'group',
  sportId: string | null = null,
  excludePlayerId: string | null = null,
  limit: number = 20
): Promise<NetworkMemberMatch[]> {
  // Step 1: Get all active member player IDs
  const { data: members, error: membersError } = await supabase
    .from('network_member')
    .select('player_id')
    .eq('network_id', networkId)
    .eq('status', 'active');

  if (membersError) {
    console.error('Error fetching network members:', membersError);
    throw new Error(membersError.message);
  }

  if (!members || members.length === 0) {
    return [];
  }

  const memberPlayerIds = members.map(m => m.player_id);

  // Step 2: Get today's date for upcoming filter
  const today = new Date().toISOString().split('T')[0];

  // Step 3: Build the query for upcoming public matches
  // We need matches where created_by OR any participant is a network member
  let query = supabase
    .from('match')
    .select(
      `
      id,
      sport_id,
      match_date,
      start_time,
      end_time,
      format,
      player_expectation,
      visibility,
      join_mode,
      location_type,
      location_name,
      facility_id,
      created_by,
      cancelled_at,
      sport:sport_id (
        id,
        name,
        display_name,
        icon_url
      ),
      facility:facility_id (
        id,
        name,
        city,
        address
      ),
      participants:match_participant (
        id,
        player_id,
        team_number,
        is_host,
        status,
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
      created_by_player:created_by (
        id,
        profile:profile!inner (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('visibility', 'public')
    .is('cancelled_at', null)
    .gte('match_date', today)
    .in('created_by', memberPlayerIds);

  // Apply visibility filter based on network type
  if (networkType === 'community') {
    query = query.eq('visible_in_communities', true);
  } else {
    query = query.eq('visible_in_groups', true);
  }

  // Apply sport filter if provided
  if (sportId) {
    query = query.eq('sport_id', sportId);
  }

  // Order by date and time, limit results
  query = query
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(limit);

  const { data: matchesByCreator, error: creatorError } = await query;

  if (creatorError) {
    console.error('Error fetching matches by creator:', creatorError);
    throw new Error(creatorError.message);
  }

  // Step 4: Also get matches where members are participants (but not creators already found)
  // Query for matches where a member is a participant with 'joined' status
  const { data: participantMatches, error: participantError } = await supabase
    .from('match_participant')
    .select('match_id')
    .in('player_id', memberPlayerIds)
    .eq('status', 'joined');

  if (participantError) {
    console.error('Error fetching participant matches:', participantError);
    throw new Error(participantError.message);
  }

  // Get unique match IDs from participants that aren't already in creator matches
  const creatorMatchIds = new Set((matchesByCreator || []).map(m => m.id));
  const participantMatchIds = [
    ...new Set(
      (participantMatches || []).map(p => p.match_id).filter(id => !creatorMatchIds.has(id))
    ),
  ];

  let matchesByParticipant: typeof matchesByCreator = [];

  if (participantMatchIds.length > 0) {
    let participantQuery = supabase
      .from('match')
      .select(
        `
        id,
        sport_id,
        match_date,
        start_time,
        end_time,
        format,
        player_expectation,
        visibility,
        join_mode,
        location_type,
        location_name,
        facility_id,
        created_by,
        cancelled_at,
        sport:sport_id (
          id,
          name,
          display_name,
          icon_url
        ),
        facility:facility_id (
          id,
          name,
          city,
          address
        ),
        participants:match_participant (
          id,
          player_id,
          team_number,
          is_host,
          status,
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
        created_by_player:created_by (
          id,
          profile:profile!inner (
            first_name,
            last_name,
            display_name,
            profile_picture_url
          )
        )
      `
      )
      .eq('visibility', 'public')
      .is('cancelled_at', null)
      .gte('match_date', today)
      .in('id', participantMatchIds);

    // Apply visibility filter based on network type
    if (networkType === 'community') {
      participantQuery = participantQuery.eq('visible_in_communities', true);
    } else {
      participantQuery = participantQuery.eq('visible_in_groups', true);
    }

    // Apply sport filter if provided
    if (sportId) {
      participantQuery = participantQuery.eq('sport_id', sportId);
    }

    const { data, error } = await participantQuery;

    if (error) {
      console.error('Error fetching participant matches details:', error);
      throw new Error(error.message);
    }

    matchesByParticipant = data || [];
  }

  // Step 5: Combine, deduplicate, and sort
  const allMatches = [...(matchesByCreator || []), ...matchesByParticipant];

  // Filter and transform matches
  const transformedMatches: NetworkMemberMatch[] = allMatches
    .filter(m => {
      // Exclude current user's matches
      if (excludePlayerId && m.created_by === excludePlayerId) {
        return false;
      }
      // Also exclude if current user is already a joined participant
      if (excludePlayerId) {
        const isParticipant = (
          (m.participants as Array<{ player_id: string; status: string }>) || []
        ).some(p => p.player_id === excludePlayerId && p.status === 'joined');
        if (isParticipant) return false;
      }
      return true;
    })
    .map(m => {
      // Handle Supabase nested response format
      const sport = Array.isArray(m.sport) ? m.sport[0] : m.sport;
      const facility = Array.isArray(m.facility) ? m.facility[0] : m.facility;
      const createdByPlayer = Array.isArray(m.created_by_player)
        ? m.created_by_player[0]
        : m.created_by_player;

      // Transform participants
      const participants = ((m.participants as Array<Record<string, unknown>>) || []).map(p => {
        const player = Array.isArray(p.player) ? p.player[0] : p.player;
        const profile = player?.profile;
        const resolvedProfile = Array.isArray(profile) ? profile[0] : profile;

        return {
          id: p.id as string,
          player_id: p.player_id as string,
          team_number: p.team_number as number | null,
          is_host: p.is_host as boolean,
          status: p.status as string,
          player: player
            ? {
                id: (player as Record<string, unknown>).id as string,
                profile: resolvedProfile
                  ? {
                      first_name: (resolvedProfile as Record<string, unknown>).first_name as string,
                      last_name: (resolvedProfile as Record<string, unknown>).last_name as
                        | string
                        | null,
                      display_name: (resolvedProfile as Record<string, unknown>).display_name as
                        | string
                        | null,
                      profile_picture_url: (resolvedProfile as Record<string, unknown>)
                        .profile_picture_url as string | null,
                    }
                  : undefined,
              }
            : undefined,
        };
      });

      // Transform created_by_player
      const creatorProfile = createdByPlayer?.profile;
      const resolvedCreatorProfile = Array.isArray(creatorProfile)
        ? creatorProfile[0]
        : creatorProfile;

      // Compute max_players based on format
      const maxPlayers = m.format === 'singles' ? 2 : 4;

      // Compute current_players (count of joined participants)
      const currentPlayers = participants.filter(p => p.status === 'joined').length;

      return {
        id: m.id,
        sport_id: m.sport_id,
        match_date: m.match_date,
        start_time: m.start_time,
        end_time: m.end_time,
        format: m.format,
        player_expectation: m.player_expectation,
        visibility: m.visibility,
        join_mode: m.join_mode,
        location_type: m.location_type,
        location_name: m.location_name,
        facility_id: m.facility_id,
        created_by: m.created_by,
        cancelled_at: m.cancelled_at,
        max_players: maxPlayers,
        current_players: currentPlayers,
        creator: resolvedCreatorProfile
          ? {
              first_name: (resolvedCreatorProfile as Record<string, unknown>).first_name as string,
              last_name: (resolvedCreatorProfile as Record<string, unknown>).last_name as
                | string
                | null,
              profile_picture_url: (resolvedCreatorProfile as Record<string, unknown>)
                .profile_picture_url as string | null,
            }
          : undefined,
        sport: sport
          ? {
              id: (sport as Record<string, unknown>).id as string,
              name: (sport as Record<string, unknown>).name as string,
              display_name: (sport as Record<string, unknown>).display_name as string,
              icon_url: (sport as Record<string, unknown>).icon_url as string | null,
            }
          : undefined,
        facility: facility
          ? {
              id: (facility as Record<string, unknown>).id as string,
              name: (facility as Record<string, unknown>).name as string,
              city: (facility as Record<string, unknown>).city as string | null,
              address: (facility as Record<string, unknown>).address as string | null,
            }
          : undefined,
        participants,
        created_by_player: createdByPlayer
          ? {
              id: (createdByPlayer as Record<string, unknown>).id as string,
              profile: resolvedCreatorProfile
                ? {
                    first_name: (resolvedCreatorProfile as Record<string, unknown>)
                      .first_name as string,
                    last_name: (resolvedCreatorProfile as Record<string, unknown>).last_name as
                      | string
                      | null,
                    display_name: (resolvedCreatorProfile as Record<string, unknown>)
                      .display_name as string | null,
                    profile_picture_url: (resolvedCreatorProfile as Record<string, unknown>)
                      .profile_picture_url as string | null,
                  }
                : undefined,
            }
          : undefined,
      } as NetworkMemberMatch;
    });

  // Sort by date and time
  transformedMatches.sort((a, b) => {
    const dateCompare = a.match_date.localeCompare(b.match_date);
    if (dateCompare !== 0) return dateCompare;
    return a.start_time.localeCompare(b.start_time);
  });

  // Return limited results
  return transformedMatches.slice(0, limit);
}
