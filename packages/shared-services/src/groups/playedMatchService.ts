/**
 * Played Match Service
 * Create played matches with results and score confirmation
 */

import { supabase } from '../supabase';
import type { CreatePlayedMatchInput, PendingScoreConfirmation } from './groupTypes';
import { postMatchToGroup } from './groupMatchService';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Find an existing scheduled match that matches the criteria
 * Returns the match_id if found, null otherwise
 */
async function findExistingMatch(
  sportId: string,
  matchDate: string,
  team1PlayerIds: string[],
  team2PlayerIds: string[]
): Promise<{ matchId: string; hasResult: boolean } | null> {
  // Get all matches on this date for this sport
  const { data: matches, error } = await supabase
    .from('match')
    .select(
      `
      id,
      sport_id,
      match_date,
      format,
      participants:match_participant (
        player_id,
        team_number
      ),
      result:match_result (
        id
      )
    `
    )
    .eq('sport_id', sportId)
    .eq('match_date', matchDate)
    .is('cancelled_at', null);

  if (error || !matches || matches.length === 0) {
    return null;
  }

  // All player IDs that should be in the match
  const allPlayerIds = [...team1PlayerIds, ...team2PlayerIds].sort();

  // Find a match with the exact same players
  for (const match of matches) {
    const participants = match.participants as Array<{ player_id: string; team_number: number }>;

    if (!participants || participants.length === 0) continue;

    // Get all participant player IDs
    const matchPlayerIds = participants.map(p => p.player_id).sort();

    // Check if all players match (same players in match)
    if (
      matchPlayerIds.length === allPlayerIds.length &&
      matchPlayerIds.every((id, idx) => id === allPlayerIds[idx])
    ) {
      // Found a match with the same players!
      // Check if it has a result
      const result = match.result as Array<{ id: string }> | null;
      const hasResult = Array.isArray(result) && result.length > 0;

      return {
        matchId: match.id,
        hasResult,
      };
    }
  }

  return null;
}

// ============================================================================
// CREATE PLAYED MATCH
// ============================================================================

/**
 * Create a played match with results
 * This is for recording past games that have already been played
 *
 * SMART MATCHING: If a scheduled match exists with the same players and date,
 * we add the result to that match instead of creating a duplicate.
 */
export async function createPlayedMatch(
  input: CreatePlayedMatchInput
): Promise<{ matchId: string; success: boolean }> {
  const {
    sportId,
    createdBy,
    matchDate,
    format,
    expectation,
    locationName,
    team1PlayerIds,
    team2PlayerIds,
    winnerId,
    sets,
    networkId,
  } = input;

  try {
    // 1. Check if a matching scheduled match already exists
    const existingMatch = await findExistingMatch(
      sportId,
      matchDate,
      team1PlayerIds,
      team2PlayerIds
    );

    let matchId: string;
    let isNewMatch = false;

    if (existingMatch) {
      // Use the existing match
      matchId = existingMatch.matchId;
      console.log(`Found existing match ${matchId}, adding result...`);

      // If the match already has a result, we shouldn't overwrite it
      if (existingMatch.hasResult) {
        console.warn(`Match ${matchId} already has a result. Skipping result creation.`);

        // Still post to group if requested
        if (networkId) {
          try {
            await postMatchToGroup(matchId, networkId, createdBy);
          } catch (postError) {
            console.error('Error posting to group:', postError);
          }
        }

        return { matchId, success: true };
      }
    } else {
      // 2. Create a new match record
      isNewMatch = true;
      const { data: match, error: matchError } = await supabase
        .from('match')
        .insert({
          sport_id: sportId,
          created_by: createdBy,
          match_date: matchDate,
          start_time: '00:00', // Unknown time for past matches
          end_time: '01:00',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          format: format === 'singles' ? 'singles' : 'doubles',
          player_expectation: expectation === 'competitive' ? 'competitive' : 'casual',
          location_type: locationName ? 'custom' : 'tbd',
          location_name: locationName || null,
          visibility: 'private', // Past matches are private by default
          join_mode: 'direct',
          is_court_free: true,
          cost_split_type: 'split_equal',
          closed_at: new Date().toISOString(), // Mark as closed since match is already played
        })
        .select('id')
        .single();

      if (matchError) {
        console.error('Error creating match:', matchError);
        throw new Error(matchError.message);
      }

      matchId = match.id;

      // 3. Deduplicate player IDs to prevent constraint violations
      // This handles edge cases where a player might appear in both teams
      const allPlayerIds = new Set<string>();
      const uniqueTeam1PlayerIds = team1PlayerIds.filter(id => {
        if (allPlayerIds.has(id)) return false;
        allPlayerIds.add(id);
        return true;
      });
      const uniqueTeam2PlayerIds = team2PlayerIds.filter(id => {
        if (allPlayerIds.has(id)) return false;
        allPlayerIds.add(id);
        return true;
      });

      // 4. Create match participants for Team 1
      const team1Participants = uniqueTeam1PlayerIds.map((playerId, index) => ({
        match_id: matchId,
        player_id: playerId,
        team_number: 1,
        is_host: index === 0, // First player in team 1 is the host
        status: 'joined' as const,
      }));

      // 5. Create match participants for Team 2
      const team2Participants = uniqueTeam2PlayerIds.map(playerId => ({
        match_id: matchId,
        player_id: playerId,
        team_number: 2,
        is_host: false,
        status: 'joined' as const,
      }));

      // 6. Insert participants - use upsert to handle any edge case duplicates
      const { error: participantsError } = await supabase
        .from('match_participant')
        .upsert([...team1Participants, ...team2Participants], {
          onConflict: 'match_id,player_id',
          ignoreDuplicates: true,
        });

      if (participantsError) {
        console.error('Error creating participants:', participantsError);
        // Cleanup: delete the match
        await supabase.from('match').delete().eq('id', matchId);
        throw new Error(participantsError.message);
      }
    }

    // 7. Create match result
    // For competitive matches: include scores
    // For friendly matches: create result without scores (marks match as completed)
    const isCompetitive = expectation === 'competitive' && sets.length > 0;

    // Calculate total scores for competitive matches
    let team1Total = 0;
    let team2Total = 0;

    if (isCompetitive) {
      sets.forEach(set => {
        if (set.team1Score !== null && set.team2Score !== null) {
          if (set.team1Score > set.team2Score) {
            team1Total++;
          } else if (set.team2Score > set.team1Score) {
            team2Total++;
          }
        }
      });
    }

    // Calculate confirmation deadline (24 hours from now)
    const confirmationDeadline = new Date();
    confirmationDeadline.setHours(confirmationDeadline.getHours() + 24);

    const { data: resultData, error: resultError } = await supabase
      .from('match_result')
      .insert({
        match_id: matchId,
        winning_team: isCompetitive ? (winnerId === 'team1' ? 1 : 2) : null,
        team1_score: isCompetitive ? team1Total : null,
        team2_score: isCompetitive ? team2Total : null,
        is_verified: false, // Opponent needs to confirm
        submitted_by: createdBy,
        confirmation_deadline: confirmationDeadline.toISOString(),
      })
      .select('id')
      .single();

    if (resultError) {
      console.error('Error creating match result:', resultError);
      // Don't fail the whole operation, result can be added later
    } else {
      // 7b. Insert individual set scores for competitive matches
      if (resultData && isCompetitive && sets.length > 0) {
        const setsToInsert = sets.map((set, index) => ({
          match_result_id: resultData.id,
          set_number: index + 1,
          team1_score: set.team1Score,
          team2_score: set.team2Score,
        }));

        const { error: setsError } = await supabase.from('match_set').insert(setsToInsert);

        if (setsError) {
          console.error('Error creating match sets:', setsError);
          // Don't fail - sets can be added later
        }
      }

      // Send notifications to opponents about pending score confirmation
      // Only for new matches, as existing match participants are already aware
      if (isNewMatch) {
        try {
          await notifyOpponentsOfPendingScore(matchId, createdBy, team2PlayerIds);
        } catch (notifyError) {
          console.error('Error sending notifications:', notifyError);
          // Don't fail - notification failure shouldn't break the flow
        }
      }
    }

    // 8. Post to group if networkId provided
    if (networkId) {
      try {
        await postMatchToGroup(matchId, networkId, createdBy);
      } catch (postError) {
        console.error('Error posting to group:', postError);
        // Don't fail, match is still created/updated
      }
    }

    return { matchId, success: true };
  } catch (error) {
    console.error('Error in createPlayedMatch:', error);
    throw error;
  }
}

/**
 * Get sport ID by name
 */
export async function getSportIdByName(sportName: 'tennis' | 'pickleball'): Promise<string | null> {
  const { data, error } = await supabase
    .from('sport')
    .select('id')
    .ilike('name', sportName)
    .single();

  if (error) {
    console.error('Error fetching sport:', error);
    return null;
  }

  return data?.id || null;
}

// ============================================================================
// SCORE CONFIRMATION
// ============================================================================

/**
 * Get pending score confirmations for a player
 */
export async function getPendingScoreConfirmations(
  playerId: string
): Promise<PendingScoreConfirmation[]> {
  const { data, error } = await supabase.rpc('get_pending_score_confirmations', {
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error fetching pending confirmations:', error);
    throw new Error(error.message);
  }

  return (data || []) as PendingScoreConfirmation[];
}

/**
 * Set score payload for submit_match_result_for_match RPC
 */
export interface SubmitMatchResultForMatchParams {
  matchId: string;
  submittedByPlayerId: string;
  winningTeam: 1 | 2;
  sets: Array<{ team1_score: number; team2_score: number }>;
}

/**
 * Submit match result for a specific match (e.g. from match detail during feedback window).
 * Caller must be a joined participant; match must have ended and be within 48h.
 * Returns the new match_result id.
 */
export async function submitMatchResultForMatch(
  params: SubmitMatchResultForMatchParams
): Promise<string> {
  const { matchId, submittedByPlayerId, winningTeam, sets } = params;
  const p_sets = sets.map(s => ({
    team1_score: s.team1_score,
    team2_score: s.team2_score,
  }));

  const { data, error } = await supabase.rpc('submit_match_result_for_match', {
    p_match_id: matchId,
    p_submitted_by: submittedByPlayerId,
    p_winning_team: winningTeam,
    p_sets,
  });

  if (error) {
    console.error('Error submitting match result:', error);
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Confirm a match score
 */
export async function confirmMatchScore(matchResultId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('confirm_match_score', {
    p_match_result_id: matchResultId,
    p_player_id: playerId,
  });

  if (error) {
    console.error('Error confirming score:', error);
    throw new Error(error.message);
  }

  return data as boolean;
}

/**
 * Dispute a match score
 */
export async function disputeMatchScore(
  matchResultId: string,
  playerId: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('dispute_match_score', {
    p_match_result_id: matchResultId,
    p_player_id: playerId,
    p_reason: reason || null,
  });

  if (error) {
    console.error('Error disputing score:', error);
    throw new Error(error.message);
  }

  return data as boolean;
}

/**
 * Send notification to opponent(s) about pending score confirmation
 */
export async function notifyOpponentsOfPendingScore(
  matchId: string,
  submittedBy: string,
  opponentIds: string[]
): Promise<void> {
  // Get submitter's profile for notification message
  const { data: submitterProfile } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name')
    .eq('id', submittedBy)
    .single();

  const submitterName =
    submitterProfile?.display_name ||
    `${submitterProfile?.first_name || ''} ${submitterProfile?.last_name || ''}`.trim() ||
    'A player';

  // Create notifications for each opponent using the correct schema columns
  // Schema: user_id, type, target_id, title, body, payload, read_at, expires_at
  const notifications = opponentIds.map(opponentId => ({
    user_id: opponentId,
    type: 'score_confirmation' as const,
    target_id: matchId,
    title: 'Score Confirmation Required',
    body: `${submitterName} submitted a match score. Please confirm or dispute within 24 hours.`,
    payload: { match_id: matchId, submitted_by: submittedBy },
  }));

  const { error } = await supabase.from('notification').insert(notifications);

  if (error) {
    console.error('Error sending score confirmation notifications:', error);
    // Don't throw - notification failure shouldn't break the flow
  }
}
