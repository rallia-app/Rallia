/**
 * useAdminAnalytics Hook
 *
 * Provides analytics data fetching and caching for admin dashboards.
 * Includes real-time stats, KPIs, and trend data.
 *
 * @example
 * ```tsx
 * const { kpi, loading, error, refetch } = useAdminAnalytics();
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getKPISummary,
  getRealtimeUserStats,
  getMatchStatistics,
  getMatchesTodayCount,
  getSportStatistics,
  getOnboardingFunnel,
  getMetricTrend,
  getWidgetTrends,
  buildDashboardWidgets,
  getPendingReportsCount,
  type KPISummary,
  type RealtimeUserStats,
  type MatchStatistics,
  type SportStatistics,
  type OnboardingFunnelStep,
  type MetricTrendPoint,
  type DashboardWidget,
} from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseAdminAnalyticsOptions {
  /** Auto-fetch on mount */
  autoFetch?: boolean;
  /** Cache duration in milliseconds (default: 5 minutes) */
  cacheDuration?: number;
  /** Specific sport ID to filter by */
  sportId?: string;
  /** Number of days for trend data (default: 7) */
  trendDays?: number;
  /** Whether to include trend data for sparklines */
  includeTrends?: boolean;
}

export interface UseAdminAnalyticsResult {
  /** Full KPI summary */
  kpi: KPISummary | null;
  /** Dashboard widgets with trend data */
  widgets: DashboardWidget[];
  /** Widget trend data by widget ID */
  trends: Record<string, MetricTrendPoint[]>;
  /** Loading state */
  loading: boolean;
  /** Trends loading separately (for lazy loading) */
  trendsLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Last updated timestamp */
  lastUpdated: Date | null;
  /** Refetch all data */
  refetch: () => Promise<void>;
  /** Refetch trends only with specific day count */
  refetchTrends: (days: number) => Promise<void>;
}

export interface UseUserStatsResult {
  /** User statistics */
  stats: RealtimeUserStats | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

export interface UseMatchStatsOptions {
  /** Sport ID filter */
  sportId?: string;
  /** Number of days to include */
  days?: number;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseMatchStatsResult {
  /** Match statistics */
  stats: MatchStatistics | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

export interface UseSportStatsResult {
  /** Sport statistics array */
  stats: SportStatistics[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

export interface UseOnboardingFunnelOptions {
  /** Number of days to include */
  days?: number;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseOnboardingFunnelResult {
  /** Onboarding funnel steps */
  funnel: OnboardingFunnelStep[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

export interface UseMetricTrendOptions {
  /** Metric type (e.g., 'users', 'matches') */
  metricType: string;
  /** Metric name (e.g., 'total_users', 'dau') */
  metricName: string;
  /** Number of days */
  days?: number;
  /** Sport ID filter */
  sportId?: string;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseMetricTrendResult {
  /** Trend data points */
  trend: MetricTrendPoint[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

// =============================================================================
// CACHE
// =============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, maxAge: number): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.timestamp < maxAge) {
    return entry.data;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Main hook for admin analytics dashboard
 */
export function useAdminAnalytics(options: UseAdminAnalyticsOptions = {}): UseAdminAnalyticsResult {
  const {
    autoFetch = true,
    cacheDuration = 5 * 60 * 1000,
    trendDays = 7,
    includeTrends = true,
  } = options;

  const [kpi, setKpi] = useState<KPISummary | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [trends, setTrends] = useState<Record<string, MetricTrendPoint[]>>({});
  const [loading, setLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isMounted = useRef(true);
  const currentTrendDays = useRef(trendDays);

  // Fetch trends data
  const fetchTrends = useCallback(
    async (days: number) => {
      const cacheKey = `widget-trends-${days}`;
      const cached = getCached<Record<string, MetricTrendPoint[]>>(cacheKey, cacheDuration);

      if (cached) {
        setTrends(cached);
        return cached;
      }

      try {
        setTrendsLoading(true);
        const trendData = await getWidgetTrends(days);

        if (isMounted.current) {
          setTrends(trendData);
          setCache(cacheKey, trendData);
        }
        return trendData;
      } catch (err) {
        console.error('Error fetching trends:', err);
        return {};
      } finally {
        if (isMounted.current) {
          setTrendsLoading(false);
        }
      }
    },
    [cacheDuration]
  );

  const fetchData = useCallback(async () => {
    // Check cache first
    const cached = getCached<KPISummary>('kpi-summary', cacheDuration);
    let trendData: Record<string, MetricTrendPoint[]> = {};

    if (cached) {
      setKpi(cached);

      // Fetch trends if enabled
      if (includeTrends) {
        trendData = await fetchTrends(currentTrendDays.current);
      }

      setWidgets(buildDashboardWidgets(cached, trendData));
      setLastUpdated(new Date(cache.get('kpi-summary')?.timestamp || Date.now()));
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data = await getKPISummary();

      // Fetch trends in parallel if enabled
      if (includeTrends) {
        trendData = await fetchTrends(currentTrendDays.current);
      }

      if (isMounted.current) {
        setKpi(data);
        setWidgets(buildDashboardWidgets(data, trendData));
        setLastUpdated(new Date());
        setCache('kpi-summary', data);
      }
    } catch (err) {
      console.error('Error fetching analytics:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [cacheDuration, includeTrends, fetchTrends]);

  const refetch = useCallback(async () => {
    // Clear cache to force refresh
    cache.delete('kpi-summary');
    cache.delete(`widget-trends-${currentTrendDays.current}`);
    await fetchData();
  }, [fetchData]);

  const refetchTrends = useCallback(
    async (days: number) => {
      currentTrendDays.current = days;
      // Clear trend cache for the new day range
      cache.delete(`widget-trends-${days}`);

      const trendData = await fetchTrends(days);

      // Rebuild widgets with new trend data
      if (kpi && isMounted.current) {
        setWidgets(buildDashboardWidgets(kpi, trendData));
      }
    },
    [fetchTrends, kpi]
  );

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    kpi,
    widgets,
    trends,
    loading,
    trendsLoading,
    error,
    lastUpdated,
    refetch,
    refetchTrends,
  };
}

/**
 * Hook for user statistics only
 */
export function useUserStats(autoFetch = true): UseUserStatsResult {
  const [stats, setStats] = useState<RealtimeUserStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getRealtimeUserStats();
      if (isMounted.current) {
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching user stats:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    stats,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for match statistics
 */
export function useMatchStats(options: UseMatchStatsOptions = {}): UseMatchStatsResult {
  const { sportId, days = 30, autoFetch = true } = options;

  const [stats, setStats] = useState<MatchStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMatchStatistics(sportId, days);
      if (isMounted.current) {
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching match stats:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [sportId, days]);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportId, days]);

  return {
    stats,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for sport-specific statistics
 */
export function useSportStats(autoFetch = true): UseSportStatsResult {
  const [stats, setStats] = useState<SportStatistics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSportStatistics();
      if (isMounted.current) {
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching sport stats:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    stats,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for onboarding funnel data
 */
export function useOnboardingFunnel(
  options: UseOnboardingFunnelOptions = {}
): UseOnboardingFunnelResult {
  const { days = 30, autoFetch = true } = options;

  const [funnel, setFunnel] = useState<OnboardingFunnelStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getOnboardingFunnel(days);
      if (isMounted.current) {
        setFunnel(data);
      }
    } catch (err) {
      console.error('Error fetching onboarding funnel:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [days]);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return {
    funnel,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for metric trend data
 */
export function useMetricTrend(options: UseMetricTrendOptions): UseMetricTrendResult {
  const { metricType, metricName, days = 7, sportId, autoFetch = true } = options;

  const [trend, setTrend] = useState<MetricTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMetricTrend(metricType, metricName, days, sportId);
      if (isMounted.current) {
        setTrend(data);
      }
    } catch (err) {
      console.error('Error fetching metric trend:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [metricType, metricName, days, sportId]);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricType, metricName, days, sportId]);

  return {
    trend,
    loading,
    error,
    refetch: fetchData,
  };
}

// =============================================================================
// ADMIN DASHBOARD STATS HOOK
// =============================================================================

export interface AdminDashboardStats {
  activeUsers: number;
  matchesToday: number;
  pendingReports: number;
}

export interface UseAdminDashboardStatsResult {
  /** Dashboard stats */
  stats: AdminDashboardStats;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch data */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch admin dashboard quick stats
 * Fetches: active users today, matches today, and pending reports
 */
export function useAdminDashboardStats(enabled: boolean = true): UseAdminDashboardStatsResult {
  const [stats, setStats] = useState<AdminDashboardStats>({
    activeUsers: 0,
    matchesToday: 0,
    pendingReports: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch all stats in parallel
      const [userStats, matchesCount, reportCounts] = await Promise.all([
        getRealtimeUserStats(),
        getMatchesTodayCount(),
        getPendingReportsCount(),
      ]);

      if (isMounted.current) {
        setStats({
          activeUsers: userStats.activeToday,
          matchesToday: matchesCount,
          pendingReports: reportCounts.pending + reportCounts.under_review,
        });
      }
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    isMounted.current = true;
    if (enabled) {
      fetchData();
    }
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    stats,
    loading,
    error,
    refetch: fetchData,
  };
}

// Re-export types for convenience
export type {
  KPISummary,
  RealtimeUserStats,
  MatchStatistics,
  SportStatistics,
  OnboardingFunnelStep,
  MetricTrendPoint,
  DashboardWidget,
} from '@rallia/shared-services';

export default useAdminAnalytics;
