/**
 * Match Feedback Types
 *
 * Types for the post-match feedback wizard UI and mutations.
 * These are UI view models and input types, not database row types.
 */

import type {
  CancellationReasonEnum,
  MatchOutcomeEnum,
  MatchReportReasonEnum,
  MatchReportPriorityEnum,
} from './database';

// ============================================
// MATCH OUTCOME (INTRO STEP)
// ============================================

/**
 * Input for updating match outcome on a participant record.
 * Used when a reviewer declares whether the match happened or was cancelled.
 */
export interface MatchOutcomeInput {
  /** The match ID */
  matchId: string;
  /** The match_participant.id for the reviewer */
  participantId: string;
  /** The reviewer's player ID (needed for creating feedback records) */
  reviewerId?: string;
  /** Whether the match was played or mutually cancelled */
  outcome: MatchOutcomeEnum;
  /** Reason for cancellation (only if outcome is 'mutual_cancel') */
  cancellationReason?: CancellationReasonEnum;
  /** Free text notes (only if cancellationReason is 'other') */
  cancellationNotes?: string;
  /** Player IDs who didn't show up (only if outcome is 'opponent_no_show') */
  noShowPlayerIds?: string[];
}

/**
 * Result from submitting match outcome.
 */
export interface MatchOutcomeResult {
  /** Whether the update was successful */
  success: boolean;
  /** The outcome that was set */
  outcome: MatchOutcomeEnum;
  /** Whether feedback is now complete (true if cancelled) */
  feedbackCompleted: boolean;
}

// ============================================
// OPPONENT FEEDBACK
// ============================================

/**
 * Input for submitting feedback about a single opponent.
 */
export interface MatchFeedbackInput {
  /** The match ID */
  matchId: string;
  /** The player ID of the reviewer (who is giving feedback) */
  reviewerId: string;
  /** The player ID of the opponent (who is receiving feedback) */
  opponentId: string;
  /** Whether the opponent showed up */
  showedUp: boolean;
  /** Whether the opponent was late (10+ min) - only if showedUp is true */
  wasLate?: boolean;
  /** Star rating 1-5 - only if showedUp is true */
  starRating?: number;
  /** Optional comments */
  comments?: string;
}

/**
 * Result from submitting opponent feedback.
 */
export interface MatchFeedbackResult {
  /** Whether the insert was successful */
  success: boolean;
  /** The created feedback record ID */
  feedbackId: string;
  /** Whether all opponents have now been rated */
  allOpponentsRated: boolean;
}

// ============================================
// WIZARD UI TYPES
// ============================================

/**
 * Opponent data for displaying in the feedback wizard.
 * Contains the info needed to render the opponent header and track feedback state.
 */
export interface OpponentForFeedback {
  /** The match_participant.id */
  participantId: string;
  /** The player.id */
  playerId: string;
  /** Display name (first name or display_name) */
  name: string;
  /** Full name for accessibility */
  fullName: string;
  /** Profile picture URL */
  avatarUrl?: string | null;
  /** Whether this opponent already has feedback from this reviewer */
  hasExistingFeedback: boolean;
  /** Whether this opponent already has a report from this reviewer */
  hasExistingReport: boolean;
}

/**
 * Data passed to the feedback sheet when opening.
 */
export interface FeedbackSheetData {
  /** The match ID */
  matchId: string;
  /** The reviewer's player ID */
  reviewerId: string;
  /** The reviewer's match_participant.id */
  participantId: string;
  /** List of opponents to provide feedback for */
  opponents: OpponentForFeedback[];
  /** IDs of opponents already rated (for resuming partial feedback) */
  alreadyRatedOpponentIds: string[];
}

/**
 * Match context data for displaying in the feedback wizard.
 * Contains the key info to help players identify which match they're rating.
 */
export interface MatchContextForFeedback {
  /** The match ID */
  matchId: string;
  /** Match date in ISO format */
  matchDate: string;
  /** Start time in HH:MM format */
  startTime: string;
  /** End time in HH:MM format (optional) */
  endTime?: string;
  /** Sport name */
  sportName: string;
  /** Sport icon/slug for display */
  sportSlug: string;
  /** Facility name (if available) */
  facilityName?: string;
  /** City where match was held */
  city?: string;
  /** Match format (e.g., "singles", "doubles") */
  format?: string;
  /** List of opponent names for quick reference */
  opponentNames: string[];
}

/**
 * Form state for a single opponent's feedback.
 */
export interface OpponentFeedbackFormState {
  /** Whether the opponent showed up (default: true) */
  showedUp: boolean;
  /** Whether the opponent was late */
  wasLate: boolean;
  /** Star rating (1-5, undefined if not set) */
  starRating?: number;
  /** Optional comments */
  comments: string;
}

/**
 * Options for the useMatchFeedback hook.
 */
export interface UseMatchFeedbackOptions {
  /** Callback when outcome submission succeeds */
  onOutcomeSuccess?: (result: MatchOutcomeResult) => void;
  /** Callback when outcome submission fails */
  onOutcomeError?: (error: Error) => void;
  /** Callback when feedback submission succeeds */
  onFeedbackSuccess?: (result: MatchFeedbackResult) => void;
  /** Callback when feedback submission fails */
  onFeedbackError?: (error: Error) => void;
  /** Callback when report submission succeeds */
  onReportSuccess?: (result: MatchReportResult) => void;
  /** Callback when report submission fails */
  onReportError?: (error: Error) => void;
}

// ============================================
// CANCELLATION REASON LABELS
// ============================================

/**
 * Display labels for cancellation reasons.
 * Keys match CancellationReasonEnum values.
 */
export const CANCELLATION_REASON_LABELS: Record<CancellationReasonEnum, string> = {
  weather: 'Weather conditions',
  court_unavailable: 'Court unavailable',
  emergency: 'Personal emergency',
  other: 'Other reason',
};

/**
 * Icons for cancellation reasons (Ionicons names).
 */
export const CANCELLATION_REASON_ICONS: Record<CancellationReasonEnum, string> = {
  weather: 'rainy-outline',
  court_unavailable: 'close-circle-outline',
  emergency: 'warning-outline',
  other: 'chatbox-ellipses-outline',
};

// ============================================
// MATCH REPORT
// ============================================

/**
 * Input for submitting a match report.
 */
export interface MatchReportInput {
  /** The match ID */
  matchId: string;
  /** The player ID of the reporter */
  reporterId: string;
  /** The player ID of the reported player */
  reportedId: string;
  /** The reason for the report */
  reason: MatchReportReasonEnum;
  /** Optional additional details */
  details?: string;
}

/**
 * Result from submitting a match report.
 */
export interface MatchReportResult {
  /** Whether the report was submitted successfully */
  success: boolean;
  /** The created report ID */
  reportId: string;
}

/**
 * Priority mapping for report reasons.
 * Used to automatically set priority based on reason.
 */
export const REPORT_REASON_PRIORITY: Record<MatchReportReasonEnum, MatchReportPriorityEnum> = {
  harassment: 'high',
  unsportsmanlike: 'medium',
  safety: 'high',
  misrepresented_level: 'low',
  inappropriate: 'medium',
};

/**
 * Icons for report reasons (Ionicons names).
 */
export const REPORT_REASON_ICONS: Record<MatchReportReasonEnum, string> = {
  harassment: 'warning-outline',
  unsportsmanlike: 'thumbs-down-outline',
  safety: 'shield-outline',
  misrepresented_level: 'trending-down-outline',
  inappropriate: 'alert-circle-outline',
};
