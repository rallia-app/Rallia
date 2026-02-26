/**
 * usePublicMatchFilters Hook
 * Manages filter state for the public matches screen.
 * Provides debounced search and filter setters.
 */

import { useState, useCallback, useMemo } from 'react';
import { useDebounce } from './useDebounce';

/**
 * Available format filter values
 */
export type FormatFilter = 'all' | 'singles' | 'doubles';

/**
 * Available match type filter values
 */
export type MatchTypeFilter = 'all' | 'casual' | 'competitive';

/**
 * Available date range filter values
 */
export type DateRangeFilter = 'all' | 'today' | 'week' | 'weekend';

/**
 * Available time of day filter values
 */
export type TimeOfDayFilter = 'all' | 'morning' | 'afternoon' | 'evening';

/**
 * Available skill level filter values
 */
export type SkillLevelFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';

/**
 * Available gender preference filter values
 */
export type GenderFilter = 'all' | 'male' | 'female' | 'other';

/**
 * Available cost filter values
 */
export type CostFilter = 'all' | 'free' | 'paid';

/**
 * Available join mode filter values
 */
export type JoinModeFilter = 'all' | 'direct' | 'request';

/**
 * Available distance filter values (in km)
 * 'all' means no distance filter - fetch all location types
 */
export type DistanceFilter = 'all' | 2 | 5 | 10;

/**
 * Available duration filter values (in minutes)
 * '120+' includes 120 minutes and custom durations
 */
export type DurationFilter = 'all' | '30' | '60' | '90' | '120+';

/**
 * Available court status filter values
 */
export type CourtStatusFilter = 'all' | 'reserved' | 'to_reserve';

/**
 * Specific date filter - ISO date string (YYYY-MM-DD) or null
 * When set, overrides the dateRange filter
 */
export type SpecificDateFilter = string | null;

/**
 * All available distance options (numeric values only for iteration)
 */
export const DISTANCE_OPTIONS_NUMERIC: (2 | 5 | 10)[] = [2, 5, 10];

/**
 * All available distance options including 'all'
 */
export const DISTANCE_OPTIONS: DistanceFilter[] = ['all', 2, 5, 10];

/**
 * Default distance filter value (no distance filter = all locations)
 */
export const DEFAULT_DISTANCE: DistanceFilter = 'all';

/**
 * All available duration options
 */
export const DURATION_OPTIONS: DurationFilter[] = ['all', '30', '60', '90', '120+'];

/**
 * All available court status options
 */
export const COURT_STATUS_OPTIONS: CourtStatusFilter[] = ['all', 'reserved', 'to_reserve'];

/**
 * Find the closest numeric distance option to a given value
 */
export function findClosestDistanceOption(value: number): 2 | 5 | 10 {
  let closest = DISTANCE_OPTIONS_NUMERIC[0];
  let minDiff = Math.abs(value - closest);

  for (const option of DISTANCE_OPTIONS_NUMERIC) {
    const diff = Math.abs(value - option);
    if (diff < minDiff) {
      minDiff = diff;
      closest = option;
    }
  }

  return closest;
}

/**
 * Check if a distance filter is numeric (has a distance constraint)
 */
export function isNumericDistanceFilter(distance: DistanceFilter): distance is 2 | 5 | 10 {
  return typeof distance === 'number';
}

/**
 * Public match filter state
 */
export interface PublicMatchFilters {
  searchQuery: string;
  format: FormatFilter;
  matchType: MatchTypeFilter;
  dateRange: DateRangeFilter;
  timeOfDay: TimeOfDayFilter;
  skillLevel: SkillLevelFilter;
  gender: GenderFilter;
  cost: CostFilter;
  joinMode: JoinModeFilter;
  distance: DistanceFilter;
  duration: DurationFilter;
  courtStatus: CourtStatusFilter;
  specificDate: SpecificDateFilter;
}

/**
 * Options for the usePublicMatchFilters hook
 */
export interface UsePublicMatchFiltersOptions {
  /** Debounce delay for search in milliseconds (default: 300) */
  debounceMs?: number;
  /** Initial filter values */
  initialFilters?: Partial<PublicMatchFilters>;
}

/**
 * Return type for usePublicMatchFilters hook
 */
export interface UsePublicMatchFiltersReturn {
  /** Current filter state */
  filters: PublicMatchFilters;
  /** Debounced search query for API calls */
  debouncedSearchQuery: string;
  /** Whether any filter is active (not default) */
  hasActiveFilters: boolean;
  /** Number of active filters (excluding search and distance) */
  activeFilterCount: number;
  /** Set the search query */
  setSearchQuery: (query: string) => void;
  /** Set the format filter */
  setFormat: (format: FormatFilter) => void;
  /** Set the match type filter */
  setMatchType: (matchType: MatchTypeFilter) => void;
  /** Set the date range filter */
  setDateRange: (dateRange: DateRangeFilter) => void;
  /** Set the time of day filter */
  setTimeOfDay: (timeOfDay: TimeOfDayFilter) => void;
  /** Set the skill level filter */
  setSkillLevel: (skillLevel: SkillLevelFilter) => void;
  /** Set the gender filter */
  setGender: (gender: GenderFilter) => void;
  /** Set the cost filter */
  setCost: (cost: CostFilter) => void;
  /** Set the join mode filter */
  setJoinMode: (joinMode: JoinModeFilter) => void;
  /** Set the distance filter */
  setDistance: (distance: DistanceFilter) => void;
  /** Set the duration filter */
  setDuration: (duration: DurationFilter) => void;
  /** Set the court status filter */
  setCourtStatus: (courtStatus: CourtStatusFilter) => void;
  /** Set the specific date filter */
  setSpecificDate: (specificDate: SpecificDateFilter) => void;
  /** Reset all filters to defaults */
  resetFilters: () => void;
  /** Clear just the search query */
  clearSearch: () => void;
}

/**
 * Hook for managing public match filter state.
 * Provides debounced search and convenient setters for each filter.
 */
export function usePublicMatchFilters(
  options: UsePublicMatchFiltersOptions = {}
): UsePublicMatchFiltersReturn {
  const { debounceMs = 300, initialFilters } = options;

  // Default is 'all' (no distance filter)
  const initialDistance: DistanceFilter = DEFAULT_DISTANCE;

  // Default filter values
  const defaultFilters: PublicMatchFilters = {
    searchQuery: '',
    format: 'all',
    matchType: 'all',
    dateRange: 'all',
    timeOfDay: 'all',
    skillLevel: 'all',
    gender: 'all',
    cost: 'all',
    joinMode: 'all',
    distance: initialDistance,
    duration: 'all',
    courtStatus: 'all',
    specificDate: null,
  };

  // Initialize filters with defaults merged with any initial values
  const [filters, setFilters] = useState<PublicMatchFilters>({
    ...defaultFilters,
    ...initialFilters,
  });

  // Store default distance for reset
  const [defaultDistance] = useState(initialDistance);

  // Normalize whitespace before debouncing so "  park  " and "park" share the same cache key
  const normalizedSearchQuery = filters.searchQuery.trim().replace(/\s+/g, ' ');
  const debouncedSearchQuery = useDebounce(normalizedSearchQuery, debounceMs);

  // Calculate if any filter is active (not default) - distance is not considered "active" for UI purposes
  const hasActiveFilters = useMemo(() => {
    return (
      filters.searchQuery !== '' ||
      filters.format !== 'all' ||
      filters.matchType !== 'all' ||
      filters.dateRange !== 'all' ||
      filters.timeOfDay !== 'all' ||
      filters.skillLevel !== 'all' ||
      filters.gender !== 'all' ||
      filters.cost !== 'all' ||
      filters.joinMode !== 'all' ||
      filters.duration !== 'all' ||
      filters.courtStatus !== 'all' ||
      filters.specificDate !== null
    );
  }, [filters]);

  // Count active filters (excluding search and distance)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.format !== 'all') count++;
    if (filters.matchType !== 'all') count++;
    if (filters.dateRange !== 'all') count++;
    if (filters.timeOfDay !== 'all') count++;
    if (filters.skillLevel !== 'all') count++;
    if (filters.gender !== 'all') count++;
    if (filters.cost !== 'all') count++;
    if (filters.joinMode !== 'all') count++;
    if (filters.duration !== 'all') count++;
    if (filters.courtStatus !== 'all') count++;
    if (filters.specificDate !== null) count++;
    return count;
  }, [filters]);

  // Individual setters
  const setSearchQuery = useCallback((searchQuery: string) => {
    setFilters(prev => ({ ...prev, searchQuery }));
  }, []);

  const setFormat = useCallback((format: FormatFilter) => {
    setFilters(prev => ({ ...prev, format }));
  }, []);

  const setMatchType = useCallback((matchType: MatchTypeFilter) => {
    setFilters(prev => ({ ...prev, matchType }));
  }, []);

  const setDateRange = useCallback((dateRange: DateRangeFilter) => {
    setFilters(prev => ({ ...prev, dateRange }));
  }, []);

  const setTimeOfDay = useCallback((timeOfDay: TimeOfDayFilter) => {
    setFilters(prev => ({ ...prev, timeOfDay }));
  }, []);

  const setSkillLevel = useCallback((skillLevel: SkillLevelFilter) => {
    setFilters(prev => ({ ...prev, skillLevel }));
  }, []);

  const setGender = useCallback((gender: GenderFilter) => {
    setFilters(prev => ({ ...prev, gender }));
  }, []);

  const setCost = useCallback((cost: CostFilter) => {
    setFilters(prev => ({ ...prev, cost }));
  }, []);

  const setJoinMode = useCallback((joinMode: JoinModeFilter) => {
    setFilters(prev => ({ ...prev, joinMode }));
  }, []);

  const setDistance = useCallback((distance: DistanceFilter) => {
    setFilters(prev => ({ ...prev, distance }));
  }, []);

  const setDuration = useCallback((duration: DurationFilter) => {
    setFilters(prev => ({ ...prev, duration }));
  }, []);

  const setCourtStatus = useCallback((courtStatus: CourtStatusFilter) => {
    setFilters(prev => ({ ...prev, courtStatus }));
  }, []);

  const setSpecificDate = useCallback((specificDate: SpecificDateFilter) => {
    setFilters(prev => ({ ...prev, specificDate }));
  }, []);

  // Reset all filters to defaults (uses player's initial distance preference)
  const resetFilters = useCallback(() => {
    setFilters({
      searchQuery: '',
      format: 'all',
      matchType: 'all',
      dateRange: 'all',
      timeOfDay: 'all',
      skillLevel: 'all',
      gender: 'all',
      cost: 'all',
      joinMode: 'all',
      distance: defaultDistance,
      duration: 'all',
      courtStatus: 'all',
      specificDate: null,
    });
  }, [defaultDistance]);

  // Clear just search
  const clearSearch = useCallback(() => {
    setFilters(prev => ({ ...prev, searchQuery: '' }));
  }, []);

  return {
    filters,
    debouncedSearchQuery,
    hasActiveFilters,
    activeFilterCount,
    setSearchQuery,
    setFormat,
    setMatchType,
    setDateRange,
    setTimeOfDay,
    setSkillLevel,
    setGender,
    setCost,
    setJoinMode,
    setDistance,
    setDuration,
    setCourtStatus,
    setSpecificDate,
    resetFilters,
    clearSearch,
  };
}

export default usePublicMatchFilters;
