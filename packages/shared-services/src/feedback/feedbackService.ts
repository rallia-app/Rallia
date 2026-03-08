/**
 * Feedback Service
 * Handles post-match feedback database operations.
 */

import { supabase } from '../supabase';
import { createReputationEvent } from '../reputation/reputationService';
import type {
  MatchFeedbackInput,
  MatchFeedbackResult,
  MatchOutcomeInput,
  MatchOutcomeResult,
  MatchReportInput,
  MatchReportResult,
  OpponentForFeedback,
  MatchParticipant,
  MatchContextForFeedback,
} from '@rallia/shared-types';
import { REPORT_REASON_PRIORITY } from '@rallia/shared-types';

// ============================================
// MATCH OUTCOME (INTRO STEP)
// ============================================

/**
 * Submit match outcome for a participant (played, mutually cancelled, or opponent no-show).
 * If cancelled or no-show, sets feedback_completed to true immediately.
 * For no-show, also creates feedback records for the no-show players.
 */
export async function submitMatchOutcome(input: MatchOutcomeInput): Promise<MatchOutcomeResult> {
  const {
    matchId,
    participantId,
    reviewerId,
    outcome,
    cancellationReason,
    cancellationNotes,
    noShowPlayerIds,
  } = input;

  // Build update data
  const updateData: Record<string, unknown> = {
    match_outcome: outcome,
  };

  // If cancelled, set feedback as complete and add cancellation reason
  if (outcome === 'mutual_cancel') {
    updateData.feedback_completed = true;
    if (cancellationReason) {
      updateData.cancellation_reason = cancellationReason;
    }
    if (cancellationNotes) {
      updateData.cancellation_notes = cancellationNotes;
    }
  }

  // If opponent no-show, set feedback as complete
  if (outcome === 'opponent_no_show') {
    updateData.feedback_completed = true;
  }

  const { error } = await supabase
    .from('match_participant')
    .update(updateData)
    .eq('id', participantId)
    .eq('match_id', matchId);

  if (error) {
    console.error('[feedbackService] Failed to update match outcome:', error);
    throw new Error(error.message);
  }

  // For opponent no-show, create feedback records for each no-show player
  if (
    outcome === 'opponent_no_show' &&
    noShowPlayerIds &&
    noShowPlayerIds.length > 0 &&
    reviewerId
  ) {
    const feedbackRecords = noShowPlayerIds.map(opponentId => ({
      match_id: matchId,
      reviewer_id: reviewerId,
      opponent_id: opponentId,
      showed_up: false,
      was_late: null,
      star_rating: null,
      comments: null,
    }));

    const { error: feedbackError } = await supabase.from('match_feedback').insert(feedbackRecords);

    if (feedbackError) {
      console.error('[feedbackService] Failed to create no-show feedback records:', feedbackError);
      // Don't throw - the outcome was saved successfully
    }

    // Create reputation events for submitting feedback
    try {
      for (let i = 0; i < noShowPlayerIds.length; i++) {
        await createReputationEvent(reviewerId, 'feedback_submitted', { matchId });
      }
    } catch (repError) {
      console.warn('[feedbackService] Failed to create reputation events:', repError);
    }
  }

  return {
    success: true,
    outcome,
    feedbackCompleted: outcome === 'mutual_cancel' || outcome === 'opponent_no_show',
  };
}

// ============================================
// OPPONENT FEEDBACK
// ============================================

/**
 * Submit feedback for a single opponent.
 * Creates a match_feedback record and a feedback_submitted reputation event.
 */
export async function submitOpponentFeedback(
  input: MatchFeedbackInput
): Promise<MatchFeedbackResult> {
  const { matchId, reviewerId, opponentId, showedUp, wasLate, starRating, comments } = input;

  // Insert feedback record
  const { data: feedback, error: feedbackError } = await supabase
    .from('match_feedback')
    .insert({
      match_id: matchId,
      reviewer_id: reviewerId,
      opponent_id: opponentId,
      showed_up: showedUp,
      was_late: showedUp ? wasLate : null,
      star_rating: showedUp ? starRating : null,
      comments: comments || null,
    })
    .select('id')
    .single();

  if (feedbackError) {
    console.error('[feedbackService] Failed to insert feedback:', feedbackError);
    throw new Error(feedbackError.message);
  }

  // Create reputation event for submitting feedback (+1)
  try {
    await createReputationEvent(reviewerId, 'feedback_submitted', { matchId });
  } catch (repError) {
    // Log but don't fail - feedback was saved successfully
    console.warn('[feedbackService] Failed to create reputation event:', repError);
  }

  // Check if all opponents have been rated
  const allOpponentsRated = await checkAllOpponentsRated(matchId, reviewerId);

  // If all opponents rated, update feedback_completed on participant record
  if (allOpponentsRated) {
    await markFeedbackCompleted(matchId, reviewerId);
  }

  return {
    success: true,
    feedbackId: feedback.id,
    allOpponentsRated,
  };
}

/**
 * Check if the reviewer has submitted feedback for all opponents in the match.
 */
async function checkAllOpponentsRated(matchId: string, reviewerId: string): Promise<boolean> {
  // Get all joined participants except the reviewer
  const { data: participants, error: participantsError } = await supabase
    .from('match_participant')
    .select('player_id')
    .eq('match_id', matchId)
    .eq('status', 'joined')
    .neq('player_id', reviewerId);

  if (participantsError || !participants) {
    console.error('[feedbackService] Failed to get participants:', participantsError);
    return false;
  }

  const opponentIds = participants.map(p => p.player_id);

  if (opponentIds.length === 0) {
    return true; // No opponents to rate
  }

  // Get feedback records from this reviewer for this match
  const { data: feedbackRecords, error: feedbackError } = await supabase
    .from('match_feedback')
    .select('opponent_id')
    .eq('match_id', matchId)
    .eq('reviewer_id', reviewerId);

  if (feedbackError || !feedbackRecords) {
    console.error('[feedbackService] Failed to get feedback records:', feedbackError);
    return false;
  }

  const ratedOpponentIds = new Set(feedbackRecords.map(f => f.opponent_id));

  // Check if all opponents have been rated
  return opponentIds.every(id => ratedOpponentIds.has(id));
}

/**
 * Mark feedback as completed for a participant.
 */
async function markFeedbackCompleted(matchId: string, reviewerId: string): Promise<void> {
  const { error } = await supabase
    .from('match_participant')
    .update({ feedback_completed: true })
    .eq('match_id', matchId)
    .eq('player_id', reviewerId);

  if (error) {
    console.error('[feedbackService] Failed to mark feedback completed:', error);
    // Don't throw - this is a non-critical update
  }
}

// ============================================
// FETCH OPPONENTS FOR FEEDBACK
// ============================================

// Type for participant query result with nested player and profile
interface ParticipantWithProfile {
  id: string;
  player_id: string;
  checked_in_at: string | null;
  player: {
    id: string;
    profile: {
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
}

/**
 * Get opponents who haven't been rated yet by the reviewer.
 * Used when resuming partial feedback.
 */
export async function getOpponentsForFeedback(
  matchId: string,
  reviewerId: string
): Promise<OpponentForFeedback[]> {
  // Get all joined participants except the reviewer, with their profile info
  const { data: participants, error: participantsError } = await supabase
    .from('match_participant')
    .select(
      `
      id,
      player_id,
      checked_in_at,
      player:player_id (
        id,
        profile (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('match_id', matchId)
    .eq('status', 'joined')
    .neq('player_id', reviewerId);

  if (participantsError || !participants) {
    console.error('[feedbackService] Failed to get participants:', participantsError);
    throw new Error('Failed to load opponents');
  }

  // Get existing feedback from this reviewer
  const { data: existingFeedback, error: feedbackError } = await supabase
    .from('match_feedback')
    .select('opponent_id')
    .eq('match_id', matchId)
    .eq('reviewer_id', reviewerId);

  if (feedbackError) {
    console.error('[feedbackService] Failed to get existing feedback:', feedbackError);
    // Continue without existing feedback info
  }

  const ratedOpponentIds = new Set(existingFeedback?.map(f => f.opponent_id) || []);

  // Get existing reports from this reviewer
  const { data: existingReports, error: reportsError } = await supabase
    .from('match_report')
    .select('reported_id')
    .eq('match_id', matchId)
    .eq('reporter_id', reviewerId);

  if (reportsError) {
    console.error('[feedbackService] Failed to get existing reports:', reportsError);
  }

  const reportedOpponentIds = new Set(existingReports?.map(r => r.reported_id) || []);

  // Map to OpponentForFeedback format
  return (participants as unknown as ParticipantWithProfile[]).map(p => {
    const profile = p.player?.profile;
    const firstName = profile?.first_name || '';
    const lastName = profile?.last_name || '';
    const displayName = profile?.display_name;

    const name = firstName || displayName || 'Player';
    const fullName = displayName || `${firstName} ${lastName}`.trim() || 'Player';

    return {
      participantId: p.id,
      playerId: p.player_id,
      name,
      fullName,
      avatarUrl: profile?.profile_picture_url || null,
      hasExistingFeedback: ratedOpponentIds.has(p.player_id),
      hasExistingReport: reportedOpponentIds.has(p.player_id),
      checkedInAt: p.checked_in_at || null,
    };
  });
}

/**
 * Get the reviewer's participant record for a match.
 */
export async function getReviewerParticipant(
  matchId: string,
  reviewerId: string
): Promise<MatchParticipant | null> {
  const { data, error } = await supabase
    .from('match_participant')
    .select('*')
    .eq('match_id', matchId)
    .eq('player_id', reviewerId)
    .eq('status', 'joined')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No matching record
      return null;
    }
    console.error('[feedbackService] Failed to get reviewer participant:', error);
    throw new Error('Failed to load participant record');
  }

  return data;
}

// Type for match context query result
interface MatchContextQueryResult {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  format: string | null;
  sport: {
    name: string;
    slug: string;
  } | null;
  facility: {
    name: string;
    city: string | null;
  } | null;
  participants: Array<{
    player_id: string;
    status: string;
    player: {
      id: string;
      profile: {
        first_name: string | null;
        display_name: string | null;
      } | null;
    } | null;
  }>;
}

/**
 * Get match context for displaying in the feedback wizard.
 * Returns key information to help players identify which match they're rating.
 */
export async function getMatchContextForFeedback(
  matchId: string,
  reviewerId: string
): Promise<MatchContextForFeedback | null> {
  const { data, error } = await supabase
    .from('match')
    .select(
      `
      id,
      match_date,
      start_time,
      end_time,
      format,
      sport:sport_id (
        name,
        slug
      ),
      facility:facility_id (
        name,
        city
      ),
      participants:match_participant (
        player_id,
        status,
        player:player_id (
          id,
          profile (
            first_name,
            display_name
          )
        )
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('[feedbackService] Failed to get match context:', error);
    throw new Error('Failed to load match context');
  }

  if (!data) {
    return null;
  }

  const matchData = data as unknown as MatchContextQueryResult;

  // Get opponent names (exclude the reviewer)
  const opponentNames = matchData.participants
    .filter(p => p.player_id !== reviewerId && p.status === 'joined')
    .map(p => {
      const profile = p.player?.profile;
      return profile?.first_name || profile?.display_name || 'Player';
    });

  return {
    matchId: matchData.id,
    matchDate: matchData.match_date,
    startTime: matchData.start_time,
    endTime: matchData.end_time || undefined,
    sportName: matchData.sport?.name || 'Unknown Sport',
    sportSlug: matchData.sport?.slug || 'tennis',
    facilityName: matchData.facility?.name || undefined,
    city: matchData.facility?.city || undefined,
    format: matchData.format || undefined,
    opponentNames,
  };
}

// ============================================
// MATCH REPORT
// ============================================

/**
 * Submit a match report for a player.
 * Creates a match_report record with appropriate priority based on reason.
 */
export async function submitMatchReport(input: MatchReportInput): Promise<MatchReportResult> {
  const { matchId, reporterId, reportedId, reason, details } = input;

  // Derive priority from reason
  const priority = REPORT_REASON_PRIORITY[reason];

  const { data: report, error } = await supabase
    .from('match_report')
    .insert({
      match_id: matchId,
      reporter_id: reporterId,
      reported_id: reportedId,
      reason,
      details: details || null,
      priority,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[feedbackService] Failed to submit match report:', error);
    throw new Error(error.message);
  }

  return {
    success: true,
    reportId: report.id,
  };
}
