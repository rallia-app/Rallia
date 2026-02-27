/**
 * Reputation System Types
 *
 * Type definitions for the player reputation system.
 * These types mirror the database schema and provide type safety
 * throughout the application.
 */

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Types of events that affect player reputation
 */
export type ReputationEventType =
  // Match-related
  | 'match_completed'
  | 'match_no_show'
  | 'match_on_time'
  | 'match_late'
  | 'match_cancelled_early'
  | 'match_cancelled_late'
  | 'match_left_late'
  // Peer reviews
  | 'review_received_5star'
  | 'review_received_4star'
  | 'review_received_3star'
  | 'review_received_2star'
  | 'review_received_1star'
  // Reports/Moderation
  | 'report_received'
  | 'report_dismissed'
  | 'report_upheld'
  | 'warning_issued'
  | 'suspension_lifted'
  // Community
  | 'peer_rating_given'
  // Feedback
  | 'feedback_submitted';

/**
 * Reputation tier levels
 */
export type ReputationTier = 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum';

// =============================================================================
// DATABASE ROW TYPES
// =============================================================================

/**
 * Reputation event record (immutable log entry)
 */
export interface ReputationEvent {
  id: string;
  player_id: string;
  event_type: ReputationEventType;
  base_impact: number;
  match_id: string | null;
  caused_by_player_id: string | null;
  metadata: Record<string, unknown>;
  event_occurred_at: string;
  created_at: string;
}

/**
 * Input for creating a new reputation event
 */
export interface ReputationEventInsert {
  player_id: string;
  event_type: ReputationEventType;
  base_impact?: number; // Will use config default if not provided
  match_id?: string | null;
  caused_by_player_id?: string | null;
  metadata?: Record<string, unknown>;
  event_occurred_at?: string;
}

/**
 * Player reputation cache record
 */
export interface PlayerReputation {
  player_id: string;
  reputation_score: number;
  reputation_tier: ReputationTier;
  total_events: number;
  positive_events: number;
  negative_events: number;
  matches_completed: number;
  is_public: boolean;
  last_decay_calculation: string | null;
  calculated_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Reputation configuration record
 */
export interface ReputationConfig {
  id: string;
  event_type: ReputationEventType;
  default_impact: number;
  min_impact: number | null;
  max_impact: number | null;
  decay_enabled: boolean;
  decay_half_life_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// VIEW MODELS
// =============================================================================

/**
 * Privacy-safe reputation summary for display
 */
export interface ReputationSummary {
  score: number;
  tier: ReputationTier;
  matchesCompleted: number;
  isPublic: boolean;
  positiveEvents: number;
  negativeEvents: number;
  totalEvents: number;
}

/**
 * Reputation display info for UI components
 */
export interface ReputationDisplay {
  /** The reputation tier */
  tier: ReputationTier;
  /** Numeric score (0-100) */
  score: number;
  /** Whether the score is visible (enough matches) */
  isVisible: boolean;
  /** Human-readable tier label */
  tierLabel: string;
  /** Tier color for badges */
  tierColor: string;
  /** Tier icon identifier */
  tierIcon: string;
}

/**
 * Tier configuration for UI display
 */
export interface TierConfig {
  label: string;
  color: string;
  backgroundColor: string;
  icon: string;
  minScore: number;
  maxScore: number;
}

// =============================================================================
// SERVICE TYPES
// =============================================================================

/**
 * Options for creating a reputation event
 */
export interface CreateReputationEventOptions {
  matchId?: string;
  causedByPlayerId?: string;
  metadata?: Record<string, unknown>;
  eventOccurredAt?: Date;
  /** Override the default impact from config */
  customImpact?: number;
}

/**
 * Options for recalculating reputation
 */
export interface RecalculateReputationOptions {
  /** Apply time-based decay to events */
  applyDecay?: boolean;
}

/**
 * Result of batch recalculation
 */
export interface BatchRecalculateResult {
  /** Number of players processed */
  processed: number;
  /** Number of players with updated scores */
  updated: number;
}

/**
 * Reputation trend direction
 */
export type ReputationTrend = 'improving' | 'stable' | 'declining';

/**
 * Extended summary for player's own profile
 */
export interface ReputationSummaryExtended extends ReputationSummary {
  /** Score trend based on recent events */
  trend: ReputationTrend;
  /** Average rating from reviews (if any) */
  averageReviewRating: number | null;
}
