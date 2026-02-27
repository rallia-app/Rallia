/**
 * Pure functions and types for match closure logic.
 * Extracted from index.ts for testability.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface MatchParticipant {
  id: string;
  player_id: string;
  match_outcome: 'played' | 'mutual_cancel' | 'opponent_no_show' | null;
  feedback_completed: boolean;
}

export interface MatchFeedback {
  id: string;
  reviewer_id: string;
  opponent_id: string;
  showed_up: boolean;
  was_late: boolean | null;
  star_rating: number | null;
}

export interface AggregatedFeedback {
  showedUp: boolean | null;
  wasLate: boolean | null;
  starRating: number | null;
  feedbackCount: number;
}

export type ReputationEventType =
  | 'match_completed'
  | 'match_no_show'
  | 'match_on_time'
  | 'match_late'
  | 'review_received_5star'
  | 'review_received_4star'
  | 'review_received_3star'
  | 'review_received_2star'
  | 'review_received_1star';

// =============================================================================
// PURE FUNCTIONS
// =============================================================================

/**
 * Check if match was mutually cancelled (majority of participants said mutual_cancel)
 */
export function isMutualCancellation(participants: MatchParticipant[]): boolean {
  const mutualCancelCount = participants.filter(p => p.match_outcome === 'mutual_cancel').length;
  const totalParticipants = participants.length;

  // Majority rule: more than half must say mutual_cancel
  return mutualCancelCount > totalParticipants / 2;
}

/**
 * Get IDs of players who were marked as no-show by others
 * (their feedback should be ignored)
 */
export function getNoShowPlayerIds(
  feedback: MatchFeedback[],
  participants: MatchParticipant[]
): Set<string> {
  const noShowIds = new Set<string>();

  for (const participant of participants) {
    // Get all feedback where this participant is the opponent
    const feedbackAboutPlayer = feedback.filter(f => f.opponent_id === participant.player_id);

    if (feedbackAboutPlayer.length === 0) continue;

    // Count how many said no-show vs showed
    const noShowCount = feedbackAboutPlayer.filter(f => !f.showed_up).length;
    const showedCount = feedbackAboutPlayer.filter(f => f.showed_up).length;

    // Majority rule: if more say no-show than showed, they're a no-show
    if (noShowCount > showedCount) {
      noShowIds.add(participant.player_id);
    }
  }

  return noShowIds;
}

/**
 * Aggregate feedback for a specific participant
 * Filters out feedback from no-show players
 * Applies majority rule with benefit of doubt on ties
 */
export function aggregateFeedback(
  participantPlayerId: string,
  feedback: MatchFeedback[],
  noShowPlayerIds: Set<string>
): AggregatedFeedback {
  // Get feedback about this participant, excluding feedback from no-show players
  const validFeedback = feedback.filter(
    f => f.opponent_id === participantPlayerId && !noShowPlayerIds.has(f.reviewer_id)
  );

  if (validFeedback.length === 0) {
    return {
      showedUp: null,
      wasLate: null,
      starRating: null,
      feedbackCount: 0,
    };
  }

  // Aggregate showed_up with majority rule
  const showedUpCount = validFeedback.filter(f => f.showed_up).length;
  const noShowCount = validFeedback.filter(f => !f.showed_up).length;

  let showedUp: boolean | null = null;
  if (showedUpCount > noShowCount) {
    showedUp = true;
  } else if (noShowCount > showedUpCount) {
    showedUp = false;
  } else {
    // Tie: benefit of doubt - no negative event (treat as showed up)
    showedUp = true;
  }

  // If no-show, don't process late or ratings
  if (!showedUp) {
    return {
      showedUp: false,
      wasLate: null,
      starRating: null,
      feedbackCount: validFeedback.length,
    };
  }

  // Aggregate was_late with majority rule
  const lateFeedback = validFeedback.filter(f => f.was_late !== null);
  const lateCount = lateFeedback.filter(f => f.was_late === true).length;
  const onTimeCount = lateFeedback.filter(f => f.was_late === false).length;

  let wasLate: boolean | null = null;
  if (lateCount > onTimeCount) {
    wasLate = true;
  } else if (onTimeCount > lateCount) {
    wasLate = false;
  } else {
    // Tie: benefit of doubt - not late
    wasLate = false;
  }

  // Average star ratings, round to nearest integer
  const ratingFeedback = validFeedback.filter(f => f.star_rating !== null);
  let starRating: number | null = null;
  if (ratingFeedback.length > 0) {
    const avgRating =
      ratingFeedback.reduce((sum, f) => sum + (f.star_rating || 0), 0) / ratingFeedback.length;
    starRating = Math.round(avgRating);
    // Clamp to 1-5
    starRating = Math.max(1, Math.min(5, starRating));
  }

  return {
    showedUp: true,
    wasLate,
    starRating,
    feedbackCount: validFeedback.length,
  };
}

/**
 * Get star rating event type
 */
export function getStarRatingEventType(rating: number): ReputationEventType {
  switch (rating) {
    case 5:
      return 'review_received_5star';
    case 4:
      return 'review_received_4star';
    case 3:
      return 'review_received_3star';
    case 2:
      return 'review_received_2star';
    case 1:
    default:
      return 'review_received_1star';
  }
}

/**
 * Determine which reputation event types should be created for aggregated feedback.
 * Extracts the event-type selection logic from createReputationEvents for testability.
 */
export function determineReputationEventTypes(
  aggregated: AggregatedFeedback
): ReputationEventType[] {
  if (aggregated.feedbackCount === 0) {
    return [];
  }

  const eventTypes: ReputationEventType[] = [];

  if (aggregated.showedUp === true) {
    eventTypes.push('match_completed');

    if (aggregated.wasLate === true) {
      eventTypes.push('match_late');
    } else if (aggregated.wasLate === false) {
      eventTypes.push('match_on_time');
    }

    if (aggregated.starRating !== null) {
      eventTypes.push(getStarRatingEventType(aggregated.starRating));
    }
  } else if (aggregated.showedUp === false) {
    eventTypes.push('match_no_show');
  }

  return eventTypes;
}
