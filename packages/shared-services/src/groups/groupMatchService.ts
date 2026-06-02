/**
 * Group Match Service
 * Operations for matches/games posted to groups, leaderboards
 */

import { supabase } from '../supabase';
import type { GroupMatch, LeaderboardEntry } from './groupTypes';
import { logGroupActivity } from './groupActivityService';
import { attachAvailableCourtCounts } from '../matches/availableCourts';
import type {
  MatchWithDetails,
  MatchParticipantWithPlayer,
  Profile,
  PlayerWithProfile,
  BadgeStatusEnum,
  FormatFilter,
  MatchTypeFilter,
  DateRangeFilter,
  TimeOfDayFilter,
  CostFilter,
  JoinModeFilter,
  DurationFilter,
  CourtStatusFilter,
  MatchTierFilter,
  SpecificDateFilter,
  SpotsAvailableFilter,
  SpecificTimeFilter,
  GenderFilter,
} from '@rallia/shared-types';

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
 * Minimum games a player must have played in the window for their win-rate to
 * be ranked. Below this threshold, `win_rate` is returned as `null` so the UI
 * can fade or down-weight the row in win-rate sort views.
 */
export const MIN_GAMES_FOR_WIN_RATE = 5;

interface PlayerProfileRow {
  id: string;
  profile?: {
    first_name: string;
    last_name: string | null;
    display_name: string | null;
    profile_picture_url: string | null;
  };
}

/**
 * Get leaderboard for a network (group or community).
 *
 * Match attribution is the union of:
 *   1. Matches explicitly posted via `match_network` for this network
 *      (`posted_at >= cutoff`).
 *   2. Auto-attribution: any match whose `match_date >= cutoff` and where at
 *      least 2 active members of the network were participants.
 *
 * Only members of the network are ranked; only matches with a verified result
 * (or whose confirmation deadline has passed) are counted.
 */
export async function getGroupLeaderboard(
  networkId: string,
  daysBack: number = 30
): Promise<LeaderboardEntry[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffISO = cutoffDate.toISOString();
  const cutoffDateOnly = cutoffISO.split('T')[0];

  // 1. Fetch network info (sport_id) and active member IDs in parallel.
  const [networkRes, membersRes, networkMatchesRes] = await Promise.all([
    supabase.from('network').select('sport_id').eq('id', networkId).maybeSingle(),
    supabase
      .from('network_member')
      .select('player_id')
      .eq('network_id', networkId)
      .eq('status', 'active'),
    supabase
      .from('match_network')
      .select('match_id')
      .eq('network_id', networkId)
      .gte('posted_at', cutoffISO),
  ]);

  if (networkRes.error) {
    console.error('Error fetching network:', networkRes.error);
    throw new Error(networkRes.error.message);
  }
  if (membersRes.error) {
    console.error('Error fetching network members:', membersRes.error);
    throw new Error(membersRes.error.message);
  }
  if (networkMatchesRes.error) {
    console.error('Error fetching match_network rows:', networkMatchesRes.error);
    throw new Error(networkMatchesRes.error.message);
  }

  const networkSportId = (networkRes.data?.sport_id as string | null) ?? null;
  const memberIds = (membersRes.data ?? []).map(m => m.player_id as string);

  if (memberIds.length === 0) {
    return [];
  }
  const memberIdSet = new Set(memberIds);

  // 2. Find auto-attributed match IDs: matches in window where ≥2 active
  //    members participated. We pull all member participations in window,
  //    then count distinct member players per match client-side.
  const { data: memberParticipations, error: mpAutoErr } = await supabase
    .from('match_participant')
    .select(
      `
      match_id,
      player_id,
      match:match_id!inner (
        id,
        match_date
      )
    `
    )
    .in('player_id', memberIds)
    .gte('match.match_date', cutoffDateOnly);

  if (mpAutoErr) {
    console.error('Error fetching member participations:', mpAutoErr);
    throw new Error(mpAutoErr.message);
  }

  const matchMemberCounts = new Map<string, Set<string>>();
  for (const mp of memberParticipations ?? []) {
    const matchData = Array.isArray(mp.match) ? mp.match[0] : mp.match;
    if (!matchData) continue;
    const matchId = mp.match_id as string;
    if (!matchMemberCounts.has(matchId)) matchMemberCounts.set(matchId, new Set());
    matchMemberCounts.get(matchId)!.add(mp.player_id as string);
  }

  const matchIdSet = new Set<string>();
  for (const [matchId, players] of matchMemberCounts) {
    if (players.size >= 2) matchIdSet.add(matchId);
  }
  for (const nm of networkMatchesRes.data ?? []) {
    matchIdSet.add(nm.match_id as string);
  }

  if (matchIdSet.size === 0) return [];

  const matchIds = Array.from(matchIdSet);

  // 3. Fetch all participants + result + match_date for the unioned match set.
  const { data: participants, error: pError } = await supabase
    .from('match_participant')
    .select(
      `
      player_id,
      team_number,
      match:match_id (
        id,
        match_date,
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

  // 4. Aggregate per player. Only members are ranked; only verified or
  //    auto-confirmed matches are counted.
  const now = new Date();
  type Pending = {
    profile?: PlayerProfileRow;
    outcomes: Array<{ won: boolean; date: string }>;
  };
  const pending = new Map<string, Pending>();

  for (const p of participants ?? []) {
    const playerId = p.player_id as string;
    if (!memberIdSet.has(playerId)) continue;

    const matchData = Array.isArray(p.match) ? p.match[0] : p.match;
    if (!matchData) continue;
    const resultData = (matchData as { result?: unknown }).result;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    if (!result) continue;

    const isVerified = (result as { is_verified: boolean }).is_verified;
    const deadlineRaw = (result as { confirmation_deadline?: string | null }).confirmation_deadline;
    const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    const deadlinePassed = deadline ? now > deadline : true;
    if (!isVerified && !deadlinePassed) continue;

    const winningTeam = (result as { winning_team: number | null }).winning_team;
    const isWinner = winningTeam !== null && (p.team_number as number | null) === winningTeam;
    const matchDate = (matchData as { match_date: string }).match_date;

    if (!pending.has(playerId)) {
      const playerData = Array.isArray(p.player) ? p.player[0] : p.player;
      let profileData: PlayerProfileRow['profile'] | undefined;
      if (playerData) {
        const rawProfile = (playerData as { profile?: unknown }).profile;
        const rawProfileObj = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
        if (rawProfileObj && typeof rawProfileObj === 'object') {
          const rp = rawProfileObj as Record<string, unknown>;
          profileData = {
            first_name: rp.first_name as string,
            last_name: (rp.last_name as string | null) ?? null,
            display_name: (rp.display_name as string | null) ?? null,
            profile_picture_url: (rp.profile_picture_url as string | null) ?? null,
          };
        }
      }
      pending.set(playerId, {
        profile: playerData
          ? {
              id: (playerData as { id: string }).id,
              profile: profileData,
            }
          : undefined,
        outcomes: [],
      });
    }

    pending.get(playerId)!.outcomes.push({ won: isWinner, date: matchDate });
  }

  // 5. Fetch skill ratings for ranked members in the network's sport.
  const rankedPlayerIds = Array.from(pending.keys());
  const skillByPlayer = new Map<string, LeaderboardEntry['skill_rating']>();

  if (networkSportId && rankedPlayerIds.length > 0) {
    const { data: ratingRows, error: rErr } = await supabase
      .from('player_rating_scores')
      .select(
        `
        player_id,
        is_certified,
        assigned_at,
        rating_score:rating_score_id (
          value,
          rating_system:rating_system_id (
            code,
            sport_id
          )
        )
      `
      )
      .in('player_id', rankedPlayerIds)
      .order('assigned_at', { ascending: false });

    if (rErr) {
      // Non-fatal — leaderboard still renders without ratings.
      console.warn('Error fetching player ratings (continuing without):', rErr);
    } else {
      for (const row of ratingRows ?? []) {
        const playerId = row.player_id as string;
        if (skillByPlayer.has(playerId)) continue;
        const ratingScore = Array.isArray(row.rating_score)
          ? row.rating_score[0]
          : row.rating_score;
        if (!ratingScore) continue;
        const value = (ratingScore as { value: number | null }).value;
        if (value == null) continue;
        const rs = (ratingScore as { rating_system?: unknown }).rating_system;
        const ratingSystem = Array.isArray(rs) ? rs[0] : rs;
        if (!ratingSystem) continue;
        const sportId = (ratingSystem as { sport_id: string }).sport_id;
        if (sportId !== networkSportId) continue;
        skillByPlayer.set(playerId, {
          value,
          system_code: (ratingSystem as { code: string }).code,
          certification_status: (row.is_certified as boolean) ? 'certified' : 'self_declared',
        });
      }
    }
  }

  // 6. Build the final entries.
  const entries: LeaderboardEntry[] = [];
  for (const [playerId, { profile, outcomes }] of pending) {
    outcomes.sort((a, b) => b.date.localeCompare(a.date));
    const games_played = outcomes.length;
    const wins = outcomes.reduce((n, o) => n + (o.won ? 1 : 0), 0);
    const losses = games_played - wins;
    const win_rate = games_played >= MIN_GAMES_FOR_WIN_RATE ? wins / games_played : null;

    let streak = 0;
    if (outcomes.length > 0) {
      const recentResult = outcomes[0].won;
      for (const o of outcomes) {
        if (o.won === recentResult) streak += 1;
        else break;
      }
      streak = recentResult ? streak : -streak;
    }

    entries.push({
      player_id: playerId,
      games_played,
      games_won: wins,
      wins,
      losses,
      win_rate,
      current_streak: streak,
      last_match_date: outcomes[0]?.date ?? null,
      skill_rating: skillByPlayer.get(playerId) ?? null,
      player: profile,
    });
  }

  return entries.sort((a, b) => b.games_played - a.games_played);
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
export interface NetworkMemberMatch extends MatchWithDetails {
  distance_meters: number | null;
}

/** Filters accepted by getNetworkMemberUpcomingMatches (mirrors PublicMatchFilters) */
export interface NetworkMatchFilters {
  searchQuery?: string;
  format?: FormatFilter;
  matchType?: MatchTypeFilter;
  dateRange?: DateRangeFilter;
  timeOfDay?: TimeOfDayFilter;
  gender?: GenderFilter;
  cost?: CostFilter;
  joinMode?: JoinModeFilter;
  duration?: DurationFilter;
  courtStatus?: CourtStatusFilter;
  matchTier?: MatchTierFilter;
  specificDate?: SpecificDateFilter;
  spotsAvailable?: SpotsAvailableFilter;
  specificTime?: SpecificTimeFilter;
  userGender?: string | null;
}

/**
 * Get upcoming public matches of network members.
 * Returns matches where a network member is either the creator or a participant.
 * Fetches full match details (same shape as public matches) so MatchCard renders
 * all elements (tier ribbons, cost badges, rating badges, court info, etc.).
 * Applies server-side filters (matching the search_public_matches RPC logic).
 */
export async function getNetworkMemberUpcomingMatches(
  networkId: string,
  networkType: 'community' | 'group',
  sportId: string | null = null,
  excludePlayerId: string | null = null,
  limit: number = 20,
  filters: NetworkMatchFilters = {}
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

  // Step 3: Get match IDs created by network members
  let creatorQuery = supabase
    .from('match')
    .select('id')
    .in('visibility', ['public', 'private'])
    .is('cancelled_at', null)
    .gte('match_date', today)
    .in('created_by', memberPlayerIds);

  if (networkType === 'community') {
    creatorQuery = creatorQuery.eq('visible_in_communities', true);
  } else {
    creatorQuery = creatorQuery.eq('visible_in_groups', true);
  }
  if (sportId) {
    creatorQuery = creatorQuery.eq('sport_id', sportId);
  }

  const { data: creatorMatches, error: creatorError } = await creatorQuery;
  if (creatorError) {
    console.error('Error fetching matches by creator:', creatorError);
    throw new Error(creatorError.message);
  }

  // Step 4: Get match IDs where members are participants.
  // Filter via the joined match row to upcoming, non-cancelled, network-visible
  // matches — otherwise this returns every historical participation and the
  // resulting `.in('id', ...)` URL in Step 5 exceeds PostgREST's limit (400).
  let participantQuery = supabase
    .from('match_participant')
    .select('match_id, match:match_id!inner(id)')
    .in('player_id', memberPlayerIds)
    .eq('status', 'joined')
    .in('match.visibility', ['public', 'private'])
    .is('match.cancelled_at', null)
    .gte('match.match_date', today);

  if (networkType === 'community') {
    participantQuery = participantQuery.eq('match.visible_in_communities', true);
  } else {
    participantQuery = participantQuery.eq('match.visible_in_groups', true);
  }
  if (sportId) {
    participantQuery = participantQuery.eq('match.sport_id', sportId);
  }

  const { data: participantMatches, error: participantError } = await participantQuery;

  if (participantError) {
    console.error('Error fetching participant matches:', participantError);
    throw new Error(participantError.message);
  }

  // Combine and deduplicate match IDs
  const allMatchIds = [
    ...new Set([
      ...(creatorMatches || []).map(m => m.id),
      ...(participantMatches || []).map(p => p.match_id),
    ]),
  ];

  if (allMatchIds.length === 0) {
    return [];
  }

  // Step 5: Fetch full match details with all joins + apply server-side filters
  // Compute date range bounds (mirrors search_public_matches RPC logic)
  let dateStart = today;
  let dateEnd: string | null = null;

  if (filters.specificDate) {
    dateStart = filters.specificDate;
    dateEnd = filters.specificDate;
  } else if (filters.dateRange && filters.dateRange !== 'all') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    switch (filters.dateRange) {
      case 'today':
        dateEnd = dateStart;
        break;
      case 'tomorrow': {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateStart = tomorrow.toISOString().split('T')[0];
        dateEnd = dateStart;
        break;
      }
      case 'week': {
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + 7);
        dateEnd = weekEnd.toISOString().split('T')[0];
        break;
      }
      case 'weekend': {
        const saturday = new Date(now);
        saturday.setDate(saturday.getDate() + (6 - saturday.getDay()));
        const sunday = new Date(saturday);
        sunday.setDate(sunday.getDate() + 1);
        dateStart = saturday.toISOString().split('T')[0];
        dateEnd = sunday.toISOString().split('T')[0];
        break;
      }
    }
  }

  let fullQuery = supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      ),
      result:match_result (
        id,
        winning_team,
        team1_score,
        team2_score,
        is_verified,
        disputed,
        submitted_by,
        confirmation_deadline,
        confirmed_by,
        verified_at,
        created_at,
        updated_at,
        rebuttal_team1_score,
        rebuttal_team2_score,
        rebuttal_winning_team,
        rebuttal_sets,
        rebuttal_submitted_by,
        rebuttal_submitted_at,
        rebuttal_deadline,
        sets:match_set (
          set_number,
          team1_score,
          team2_score
        ),
        confirmations:score_confirmation (
          player_id,
          action
        )
      )
    `
    )
    .in('id', allMatchIds)
    .is('cancelled_at', null)
    .gte('match_date', dateStart);

  if (dateEnd) {
    fullQuery = fullQuery.lte('match_date', dateEnd);
  }

  // Re-apply visibility filter (participant matches may not have been filtered)
  if (networkType === 'community') {
    fullQuery = fullQuery.eq('visible_in_communities', true);
  } else {
    fullQuery = fullQuery.eq('visible_in_groups', true);
  }
  if (sportId) {
    fullQuery = fullQuery.eq('sport_id', sportId);
  }

  // Apply column-based filters via Supabase query builders
  if (filters.format && filters.format !== 'all') {
    fullQuery = fullQuery.eq('format', filters.format);
  }
  if (filters.joinMode && filters.joinMode !== 'all') {
    fullQuery = fullQuery.eq('join_mode', filters.joinMode);
  }
  if (filters.courtStatus && filters.courtStatus !== 'all') {
    fullQuery = fullQuery.eq('court_status', filters.courtStatus);
  }
  if (filters.cost && filters.cost !== 'all') {
    if (filters.cost === 'free') {
      fullQuery = fullQuery.eq('is_court_free', true);
    } else {
      // paid: either is_court_free is false or estimated_cost exists
      fullQuery = fullQuery.eq('is_court_free', false);
    }
  }
  if (filters.duration && filters.duration !== 'all') {
    if (filters.duration === '120+') {
      fullQuery = fullQuery.in('duration', ['120', 'custom']);
    } else {
      fullQuery = fullQuery.eq('duration', filters.duration);
    }
  }
  if (filters.gender && filters.gender !== 'all') {
    fullQuery = fullQuery.eq('preferred_opponent_gender', filters.gender);
  }

  // Time of day / specific time filter
  if (filters.specificTime) {
    // ±1 hour window around the specific time
    const [h, m] = filters.specificTime.split(':').map(Number);
    const startH = Math.max(0, h - 1);
    const endH = Math.min(23, h + 1);
    const startTime = `${String(startH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const endTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    fullQuery = fullQuery.gte('start_time', startTime).lt('start_time', endTime);
  } else if (filters.timeOfDay && filters.timeOfDay !== 'all') {
    // Boundaries aligned with the 6-block player availability taxonomy
    // (morning = early+morning, afternoon = midday+afternoon, evening =
    // evening+late) so the same word means a coherent time range across
    // the player and match surfaces.
    switch (filters.timeOfDay) {
      case 'morning':
        fullQuery = fullQuery.gte('start_time', '06:00:00').lt('start_time', '12:00:00');
        break;
      case 'afternoon':
        fullQuery = fullQuery.gte('start_time', '12:00:00').lt('start_time', '17:00:00');
        break;
      case 'evening':
        fullQuery = fullQuery.gte('start_time', '17:00:00').lte('start_time', '23:59:59');
        break;
    }
  }

  // matchType filter: 'casual' matches both 'casual' and 'both'; same for 'competitive'
  if (filters.matchType && filters.matchType !== 'all') {
    if (filters.matchType === 'casual') {
      fullQuery = fullQuery.in('player_expectation', ['casual', 'both']);
    } else {
      fullQuery = fullQuery.in('player_expectation', ['competitive', 'both']);
    }
  }

  // Gender eligibility: exclude matches with a gender preference the user doesn't match
  if (filters.userGender) {
    fullQuery = fullQuery.or(
      `preferred_opponent_gender.is.null,preferred_opponent_gender.eq.${filters.userGender}`
    );
  }

  const { data: matchesData, error: matchError } = await fullQuery;

  if (matchError) {
    console.error('Error fetching full match details:', matchError);
    throw new Error(matchError.message);
  }

  if (!matchesData || matchesData.length === 0) {
    return [];
  }

  // Step 6: Fetch profiles for all players (same pattern as getPublicMatches)
  const playerIds = new Set<string>();
  matchesData.forEach((match: MatchWithDetails) => {
    if (match.created_by_player?.id) {
      playerIds.add(match.created_by_player.id);
    }
    if (match.participants) {
      match.participants.forEach((p: MatchParticipantWithPlayer) => {
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        if (playerObj?.id) {
          playerIds.add(playerObj.id);
        }
      });
    }
  });

  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Step 7: Fetch player ratings for the match's sport
  const publicRatingsMap: Record<
    string,
    { label: string; value: number | null; badgeStatus?: BadgeStatusEnum }
  > = {};

  if (profileIds.length > 0 && sportId) {
    const { data: ratingsData, error: ratingsError } = await supabase
      .from('player_rating_score')
      .select(
        `
        player_id,
        badge_status,
        rating_score!player_rating_scores_rating_score_id_fkey!inner (
          label,
          value,
          rating_system!inner (
            sport_id
          )
        )
      `
      )
      .in('player_id', profileIds);

    if (!ratingsError && ratingsData) {
      type RatingResult = {
        player_id: string;
        badge_status?: BadgeStatusEnum;
        rating_score: { label: string; value: number | null; rating_system: { sport_id: string } };
      };
      (ratingsData as unknown as RatingResult[]).forEach(rating => {
        const ratingScore = rating.rating_score;
        const ratingSystem = ratingScore?.rating_system;
        if (ratingSystem?.sport_id === sportId && ratingScore?.label) {
          const existing = publicRatingsMap[rating.player_id];
          const badgeStatus =
            existing?.badgeStatus === 'certified' ? 'certified' : rating.badge_status;
          publicRatingsMap[rating.player_id] = {
            label: ratingScore.label,
            value: ratingScore.value,
            badgeStatus,
          };
        }
      });
    }
  }

  // Step 8: Attach profiles, ratings to matches; apply post-fetch filters; sort
  const { getTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const enrichedMatches: NetworkMemberMatch[] = [];

  matchesData.forEach((match: MatchWithDetails) => {
    // Exclude current user's matches
    if (excludePlayerId && match.created_by === excludePlayerId) {
      return;
    }
    if (excludePlayerId && match.participants) {
      const isParticipant = match.participants.some((p: MatchParticipantWithPlayer) => {
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        return playerObj?.id === excludePlayerId && p.status === 'joined';
      });
      if (isParticipant) return;
    }

    // Filter out matches that have already started (timezone-aware)
    const timeDiff = getTimeDifferenceFromNow(
      match.match_date,
      match.start_time,
      match.timezone || 'UTC'
    );
    if (timeDiff <= 0) return;

    // Attach profile and rating to creator
    if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
      match.created_by_player.profile = profilesMap[match.created_by_player.id];
      const creatorRating = publicRatingsMap[match.created_by_player.id];
      if (creatorRating) {
        (match.created_by_player as PlayerWithProfile).sportRatingLabel = creatorRating.label;
        if (creatorRating.value !== null) {
          (match.created_by_player as PlayerWithProfile).sportRatingValue = creatorRating.value;
        }
        if (creatorRating.badgeStatus) {
          (match.created_by_player as PlayerWithProfile).sportCertificationStatus =
            creatorRating.badgeStatus;
        }
      }
    }

    // Attach profiles and ratings to participants
    if (match.participants) {
      match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const playerId = playerObj?.id;

        if (playerId && profilesMap[playerId]) {
          playerObj.profile = profilesMap[playerId];
        }
        const participantRating = playerId ? publicRatingsMap[playerId] : undefined;
        if (participantRating && playerObj) {
          (playerObj as PlayerWithProfile).sportRatingLabel = participantRating.label;
          if (participantRating.value !== null) {
            (playerObj as PlayerWithProfile).sportRatingValue = participantRating.value;
          }
          if (participantRating.badgeStatus) {
            (playerObj as PlayerWithProfile).sportCertificationStatus =
              participantRating.badgeStatus;
          }
        }
        if (Array.isArray(p.player) && playerObj) {
          p.player = playerObj;
        }
        return p;
      });
    }

    // --- Post-fetch filters (require participant data or text matching) ---

    // Spots available filter
    const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
    const totalSpots = match.format === 'doubles' ? 4 : 2;
    const spotsLeft = totalSpots - joined.length;

    // Only show matches with open spots
    if (spotsLeft <= 0) return;

    if (filters.spotsAvailable && filters.spotsAvailable !== 'all') {
      const wanted = parseInt(filters.spotsAvailable, 10);
      if (wanted === 3) {
        if (spotsLeft < 3) return;
      } else {
        if (spotsLeft !== wanted) return;
      }
    }

    // Match tier filter (requires participant reputation + certification data)
    if (filters.matchTier && filters.matchTier !== 'all') {
      const covetedCount = joined.filter(p => {
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const repScore = (playerObj as PlayerWithProfile)?.player_reputation?.reputation_score;
        const certStatus = (playerObj as PlayerWithProfile)?.sportCertificationStatus;
        return (repScore ?? 0) >= 90 && certStatus === 'certified';
      }).length;
      const covetedThreshold = match.format === 'doubles' ? 2 : 1;

      switch (filters.matchTier) {
        case 'mostWanted':
          if (match.court_status !== 'reserved' || covetedCount < covetedThreshold) return;
          break;
        case 'covetedPlayers':
          if (covetedCount < covetedThreshold) return;
          break;
        case 'courtBooked':
          if (match.court_status !== 'reserved') return;
          break;
      }
    }

    // Search filter (text matching across host name, facility, location)
    if (filters.searchQuery && filters.searchQuery.trim()) {
      const query = filters.searchQuery.toLowerCase().trim();
      const words = query.split(/\s+/).filter(Boolean);
      const hostProfile = match.created_by_player?.profile;
      const hostName = [hostProfile?.first_name, hostProfile?.last_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const displayName = (hostProfile?.display_name ?? '').toLowerCase();
      const facilityName = (match.facility?.name ?? '').toLowerCase();
      const locationName = (match.location_name ?? '').toLowerCase();

      const allWordsMatch = words.every(
        word =>
          hostName.includes(word) ||
          displayName.includes(word) ||
          facilityName.includes(word) ||
          locationName.includes(word)
      );
      if (!allWordsMatch) return;
    }

    enrichedMatches.push({
      ...match,
      distance_meters: null,
    });
  });

  // Sort by date and time
  enrichedMatches.sort((a, b) => {
    const dateCompare = a.match_date.localeCompare(b.match_date);
    if (dateCompare !== 0) return dateCompare;
    return a.start_time.localeCompare(b.start_time);
  });

  // Attach open-court counts so MatchCard can show a "N courts available" chip
  // for unreserved future matches (parity with suggestion cards). Only the
  // matches we actually return are enriched.
  const visibleMatches = enrichedMatches.slice(0, limit);
  await attachAvailableCourtCounts(visibleMatches);
  return visibleMatches;
}
