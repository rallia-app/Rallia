/**
 * Match Filter Types
 *
 * Canonical filter type definitions used across hooks, services, and UI.
 * Filter types extend DB enums with an 'all' sentinel for "no filter" state.
 */

import type {
  MatchFormatEnum,
  MatchTypeEnum,
  MatchJoinModeEnum,
  CourtStatusEnum,
  GenderEnum,
} from './database';

// ============================================
// PUBLIC MATCH FILTERS
// ============================================

export type FormatFilter = 'all' | MatchFormatEnum;
export type MatchTypeFilter = 'all' | Extract<MatchTypeEnum, 'casual' | 'competitive'>;
export type GenderFilter = 'all' | GenderEnum;
export type JoinModeFilter = 'all' | MatchJoinModeEnum;
export type CourtStatusFilter = 'all' | CourtStatusEnum;

/** Date range presets for match search */
export type DateRangeFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'weekend';

/** Time of day presets */
export type TimeOfDayFilter = 'all' | 'morning' | 'afternoon' | 'evening';

/** Skill level presets */
export type SkillLevelFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';

/** Cost filter */
export type CostFilter = 'all' | 'free' | 'paid';

/** Distance filter (in km) — 'all' means no distance constraint */
export type DistanceFilter = 'all' | 2 | 5 | 10;

/** Duration filter (in minutes) — '120+' includes 120 and custom */
export type DurationFilter = 'all' | '30' | '60' | '90' | '120+';

/** Match tier filter */
export type MatchTierFilter = 'all' | 'mostWanted' | 'covetedPlayers' | 'courtBooked';

/** Specific date filter — ISO date string (YYYY-MM-DD) or null */
export type SpecificDateFilter = string | null;

/** Spots available filter */
export type SpotsAvailableFilter = 'all' | '1' | '2' | '3';

/** Specific time filter — HH:MM format or null */
export type SpecificTimeFilter = string | null;

// ============================================
// PLAYER MATCH FILTERS
// ============================================

/** Status filter values for upcoming player matches */
export type UpcomingMatchFilter =
  | 'all'
  | 'hosting'
  | 'confirmed'
  | 'waiting'
  | 'needs_players'
  | 'private';

/** Status filter values for past player matches */
export type PastMatchFilter =
  | 'all'
  | 'feedback_needed'
  | 'completed'
  | 'hosted'
  | 'unfilled'
  | 'cancelled'
  | 'private';

/** Union type for all player match filters */
export type PlayerMatchFilter = UpcomingMatchFilter | PastMatchFilter;
