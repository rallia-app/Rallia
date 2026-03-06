/**
 * usePlayerMatchFilters Hook
 * Manages filter state for the player matches screen (My Games).
 * Provides separate filter options for upcoming vs past matches.
 * Uses single-select behavior (WhatsApp-style chips).
 */

import { useState, useCallback, useMemo } from 'react';
import type { UpcomingMatchFilter, PastMatchFilter, PlayerMatchFilter } from '@rallia/shared-types';

// Re-export filter types for consumers that import from this hook
export type { UpcomingMatchFilter, PastMatchFilter, PlayerMatchFilter };

/**
 * All available upcoming filter options (for UI iteration)
 */
export const UPCOMING_FILTER_OPTIONS: UpcomingMatchFilter[] = [
  'all',
  'confirmed',
  'hosting',
  'needs_players',
  'waiting',
  'private',
];

/**
 * All available past filter options (for UI iteration)
 */
export const PAST_FILTER_OPTIONS: PastMatchFilter[] = [
  'all',
  'feedback_needed',
  'completed',
  'hosted',
  'cancelled',
  'unfilled',
  'private',
];

/**
 * Filter state for player matches
 */
export interface PlayerMatchFiltersState {
  upcomingFilter: UpcomingMatchFilter;
  pastFilter: PastMatchFilter;
}

/**
 * Options for the usePlayerMatchFilters hook
 */
export interface UsePlayerMatchFiltersOptions {
  /** Initial upcoming filter value */
  initialUpcomingFilter?: UpcomingMatchFilter;
  /** Initial past filter value */
  initialPastFilter?: PastMatchFilter;
}

/**
 * Return type for usePlayerMatchFilters hook
 */
export interface UsePlayerMatchFiltersReturn {
  /** Current upcoming filter */
  upcomingFilter: UpcomingMatchFilter;
  /** Current past filter */
  pastFilter: PastMatchFilter;
  /** Whether upcoming filter is active (not 'all') */
  hasActiveUpcomingFilter: boolean;
  /** Whether past filter is active (not 'all') */
  hasActivePastFilter: boolean;
  /** Set the upcoming filter */
  setUpcomingFilter: (filter: UpcomingMatchFilter) => void;
  /** Set the past filter */
  setPastFilter: (filter: PastMatchFilter) => void;
  /** Reset upcoming filter to 'all' */
  resetUpcomingFilter: () => void;
  /** Reset past filter to 'all' */
  resetPastFilter: () => void;
  /** Reset both filters to 'all' */
  resetAllFilters: () => void;
  /** Toggle a filter - if already selected, reset to 'all' */
  toggleUpcomingFilter: (filter: UpcomingMatchFilter) => void;
  /** Toggle a filter - if already selected, reset to 'all' */
  togglePastFilter: (filter: PastMatchFilter) => void;
}

/**
 * Hook for managing player match filter state.
 * Provides separate filters for upcoming and past matches.
 * Supports single-select toggle behavior (tapping active filter deselects it).
 *
 * @example
 * ```tsx
 * const { upcomingFilter, toggleUpcomingFilter, pastFilter, togglePastFilter } =
 *   usePlayerMatchFilters();
 *
 * // In upcoming tab:
 * <FilterChip
 *   active={upcomingFilter === 'hosting'}
 *   onPress={() => toggleUpcomingFilter('hosting')}
 * />
 * ```
 */
export function usePlayerMatchFilters(
  options: UsePlayerMatchFiltersOptions = {}
): UsePlayerMatchFiltersReturn {
  const { initialUpcomingFilter = 'all', initialPastFilter = 'all' } = options;

  const [upcomingFilter, setUpcomingFilterState] =
    useState<UpcomingMatchFilter>(initialUpcomingFilter);
  const [pastFilter, setPastFilterState] = useState<PastMatchFilter>(initialPastFilter);

  // Check if filters are active
  const hasActiveUpcomingFilter = useMemo(() => upcomingFilter !== 'all', [upcomingFilter]);
  const hasActivePastFilter = useMemo(() => pastFilter !== 'all', [pastFilter]);

  // Setters
  const setUpcomingFilter = useCallback((filter: UpcomingMatchFilter) => {
    setUpcomingFilterState(filter);
  }, []);

  const setPastFilter = useCallback((filter: PastMatchFilter) => {
    setPastFilterState(filter);
  }, []);

  // Reset functions
  const resetUpcomingFilter = useCallback(() => {
    setUpcomingFilterState('all');
  }, []);

  const resetPastFilter = useCallback(() => {
    setPastFilterState('all');
  }, []);

  const resetAllFilters = useCallback(() => {
    setUpcomingFilterState('all');
    setPastFilterState('all');
  }, []);

  // Toggle functions (single-select behavior)
  const toggleUpcomingFilter = useCallback((filter: UpcomingMatchFilter) => {
    setUpcomingFilterState(prev => (prev === filter ? 'all' : filter));
  }, []);

  const togglePastFilter = useCallback((filter: PastMatchFilter) => {
    setPastFilterState(prev => (prev === filter ? 'all' : filter));
  }, []);

  return {
    upcomingFilter,
    pastFilter,
    hasActiveUpcomingFilter,
    hasActivePastFilter,
    setUpcomingFilter,
    setPastFilter,
    resetUpcomingFilter,
    resetPastFilter,
    resetAllFilters,
    toggleUpcomingFilter,
    togglePastFilter,
  };
}

export default usePlayerMatchFilters;
