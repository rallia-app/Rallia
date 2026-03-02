/**
 * useAnalyticsTimeRange Hook
 * 
 * Manages time range state for analytics views with persistence.
 * Supports 7d, 30d, 90d, and YTD (year-to-date) ranges.
 */

import { useState, useCallback, useMemo } from 'react';
import { getStorageAdapter } from './storage';

export type TimeRangeOption = '7d' | '30d' | '90d' | 'ytd';

export interface TimeRange {
  /** The selected time range option */
  option: TimeRangeOption;
  /** Start date of the range */
  startDate: Date;
  /** End date of the range (today) */
  endDate: Date;
  /** Number of days in the range */
  days: number;
  /** Human-readable label */
  label: string;
}

export interface UseAnalyticsTimeRangeOptions {
  /** Storage key for persistence */
  storageKey?: string;
  /** Default time range option */
  defaultRange?: TimeRangeOption;
  /** Callback when range changes */
  onRangeChange?: (range: TimeRange) => void;
}

const STORAGE_KEY = 'analytics_time_range';

const TIME_RANGE_LABELS: Record<TimeRangeOption, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'ytd': 'Year to date',
};

/**
 * Calculate the number of days for a time range option
 */
function getDaysForOption(option: TimeRangeOption): number {
  const now = new Date();
  
  switch (option) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case 'ytd': {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const diffTime = now.getTime() - startOfYear.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    default:
      return 7;
  }
}

/**
 * Calculate the start date for a time range option
 */
function getStartDate(option: TimeRangeOption): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  switch (option) {
    case '7d':
      return new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Build a TimeRange object from an option
 */
function buildTimeRange(option: TimeRangeOption): TimeRange {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  
  return {
    option,
    startDate: getStartDate(option),
    endDate,
    days: getDaysForOption(option),
    label: TIME_RANGE_LABELS[option],
  };
}

/**
 * Hook for managing analytics time range state
 */
export function useAnalyticsTimeRange(options: UseAnalyticsTimeRangeOptions = {}) {
  const {
    storageKey = STORAGE_KEY,
    defaultRange = '7d',
    onRangeChange,
  } = options;

  const [selectedOption, setSelectedOption] = useState<TimeRangeOption>(defaultRange);
  const [isLoading, setIsLoading] = useState(true);

  // Build the current time range
  const timeRange = useMemo(() => buildTimeRange(selectedOption), [selectedOption]);

  // Load persisted range on mount
  const loadPersistedRange = useCallback(async () => {
    try {
      const storage = getStorageAdapter();
      const stored = await storage.getItem(storageKey);
      if (stored && ['7d', '30d', '90d', 'ytd'].includes(stored)) {
        setSelectedOption(stored as TimeRangeOption);
      }
    } catch (error) {
      console.error('Error loading persisted time range:', error);
    } finally {
      setIsLoading(false);
    }
  }, [storageKey]);

  // Persist and update range
  const setRange = useCallback(async (option: TimeRangeOption) => {
    setSelectedOption(option);
    
    try {
      const storage = getStorageAdapter();
      await storage.setItem(storageKey, option);
    } catch (error) {
      console.error('Error persisting time range:', error);
    }

    const newRange = buildTimeRange(option);
    onRangeChange?.(newRange);
  }, [storageKey, onRangeChange]);

  // Initialize on mount
  useState(() => {
    loadPersistedRange();
  });

  // Quick selection helpers
  const selectLast7Days = useCallback(() => setRange('7d'), [setRange]);
  const selectLast30Days = useCallback(() => setRange('30d'), [setRange]);
  const selectLast90Days = useCallback(() => setRange('90d'), [setRange]);
  const selectYearToDate = useCallback(() => setRange('ytd'), [setRange]);

  // Get all available options with labels
  const availableOptions = useMemo(() => [
    { value: '7d' as const, label: TIME_RANGE_LABELS['7d'], days: 7 },
    { value: '30d' as const, label: TIME_RANGE_LABELS['30d'], days: 30 },
    { value: '90d' as const, label: TIME_RANGE_LABELS['90d'], days: 90 },
    { value: 'ytd' as const, label: TIME_RANGE_LABELS['ytd'], days: getDaysForOption('ytd') },
  ], []);

  // Format date for display
  const formatDateRange = useCallback(() => {
    const start = timeRange.startDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const end = timeRange.endDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    return `${start} - ${end}`;
  }, [timeRange]);

  return {
    // Current state
    selectedOption,
    timeRange,
    isLoading,
    
    // Actions
    setRange,
    selectLast7Days,
    selectLast30Days,
    selectLast90Days,
    selectYearToDate,
    
    // Utilities
    availableOptions,
    formatDateRange,
    getDaysForOption,
  };
}

export default useAnalyticsTimeRange;
