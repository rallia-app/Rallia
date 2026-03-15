/**
 * Reputation System Configuration
 *
 * Default configuration values and tier definitions.
 * These values are used when the database config is not available
 * or as fallbacks during development.
 */

import type { ReputationEventType, ReputationTier, TierConfig } from './reputationTypes';

// =============================================================================
// DEFAULT EVENT IMPACTS
// =============================================================================

/**
 * Default impact values for each event type.
 * These match the database seed values and are used as fallbacks.
 */
export const DEFAULT_EVENT_IMPACTS: Record<ReputationEventType, number> = {
  // Match-related
  match_completed: 12,
  match_no_show: -50,
  match_on_time: 3,
  match_late: -10,
  match_cancelled_early: 0,
  match_cancelled_late: -35,
  match_left_late: -22,

  // Peer reviews
  review_received_5star: 10,
  review_received_4star: 5,
  review_received_3star: 0,
  review_received_2star: -5,
  review_received_1star: -10,
  feedback_submitted: 1,

  // Reports/Moderation
  report_received: 0,
  report_dismissed: 5,
  report_upheld: -15,
  warning_issued: -10,
  suspension_lifted: 0,

  // Community
  peer_rating_given: 1,
};

// =============================================================================
// TIER CONFIGURATION
// =============================================================================

/**
 * Tier color palette
 */
export const TIER_COLORS = {
  unknown: {
    primary: '#9CA3AF', // gray-400
    background: '#F3F4F6', // gray-100
    text: '#6B7280', // gray-500
  },
  bronze: {
    primary: '#CD7F32', // bronze
    background: '#FEF3C7', // amber-100
    text: '#92400E', // amber-800
  },
  silver: {
    primary: '#C0C0C0', // silver
    background: '#F3F4F6', // gray-100
    text: '#374151', // gray-700
  },
  gold: {
    primary: '#FFD700', // gold
    background: '#FEF9C3', // yellow-100
    text: '#854D0E', // yellow-800
  },
  platinum: {
    primary: '#E5E4E2', // platinum
    background: '#EDE9FE', // violet-100
    text: '#5B21B6', // violet-800
  },
} as const;

/**
 * Tier configuration for UI display
 */
export const TIER_CONFIGS: Record<ReputationTier, TierConfig> = {
  unknown: {
    label: 'New Player',
    color: TIER_COLORS.unknown.primary,
    backgroundColor: TIER_COLORS.unknown.background,
    icon: 'help-circle',
    minScore: 0,
    maxScore: 100,
  },
  bronze: {
    label: 'Bronze',
    color: TIER_COLORS.bronze.primary,
    backgroundColor: TIER_COLORS.bronze.background,
    icon: 'shield',
    minScore: 0,
    maxScore: 59,
  },
  silver: {
    label: 'Silver',
    color: TIER_COLORS.silver.primary,
    backgroundColor: TIER_COLORS.silver.background,
    icon: 'shield',
    minScore: 60,
    maxScore: 74,
  },
  gold: {
    label: 'Gold',
    color: TIER_COLORS.gold.primary,
    backgroundColor: TIER_COLORS.gold.background,
    icon: 'shield',
    minScore: 75,
    maxScore: 89,
  },
  platinum: {
    label: 'Platinum',
    color: TIER_COLORS.platinum.primary,
    backgroundColor: TIER_COLORS.platinum.background,
    icon: 'ribbon',
    minScore: 90,
    maxScore: 100,
  },
};

// =============================================================================
// SYSTEM CONSTANTS
// =============================================================================

/**
 * Minimum reputation events required before reputation is visible to others.
 * This is more comprehensive than matches alone as it includes reviews,
 * reports, and other interactions.
 */
export const MIN_EVENTS_FOR_PUBLIC = 5;

/**
 * Base reputation score for new players
 */
export const BASE_REPUTATION_SCORE = 100;

/**
 * Default decay half-life in days
 */
export const DEFAULT_DECAY_HALF_LIFE_DAYS = 180;

/**
 * Maximum reputation score
 */
export const MAX_REPUTATION_SCORE = 100;

/**
 * Minimum reputation score
 */
export const MIN_REPUTATION_SCORE = 0;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the tier for a given score and event count
 */
export function getTierForScore(score: number, totalEvents: number): ReputationTier {
  if (totalEvents < MIN_EVENTS_FOR_PUBLIC) {
    return 'unknown';
  }

  if (score >= 90) return 'platinum';
  if (score >= 75) return 'gold';
  if (score >= 60) return 'silver';
  return 'bronze';
}

/**
 * Get tier configuration for a given tier
 */
export function getTierConfig(tier: ReputationTier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Get the default impact for an event type
 */
export function getDefaultImpact(eventType: ReputationEventType): number {
  return DEFAULT_EVENT_IMPACTS[eventType] ?? 0;
}

/**
 * Format score as percentage string
 */
export function formatScore(score: number): string {
  return `${Math.round(score)}%`;
}

/**
 * Check if a score is considered "good" (silver or above)
 */
export function isGoodReputation(score: number, totalEvents: number): boolean {
  if (totalEvents < MIN_EVENTS_FOR_PUBLIC) {
    return true; // Give benefit of doubt to new players
  }
  return score >= 60;
}
