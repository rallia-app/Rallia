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
  getInvitationStats,
  getInvitationTopTargets,
  getInvitationTimeseries,
  resolveInvitationTargets,
  getUtmSignupStats,
  getUtmTotalsComparison,
  getUtmCampaigns,
  createUtmCampaign,
  archiveUtmCampaign,
  getMatchFillAnalytics,
  type KPISummary,
  type RealtimeUserStats,
  type MatchStatistics,
  type SportStatistics,
  type OnboardingFunnelStep,
  type MetricTrendPoint,
  type DashboardWidget,
  type InvitationStat,
  type InvitationTopTarget,
  type InvitationType,
  type InvitationTimeseries,
  type InvitationTimeseriesPoint,
  type UtmSignupStat,
  type UtmCampaign,
  type UtmTotalsComparison,
  type MatchFillPoint,
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
// POLLING
// =============================================================================

/**
 * Polling effect that pauses while the tab is backgrounded and refetches on
 * refocus — stops a forgotten admin tab from hammering the API 24/7. Pass
 * `null`/`0` to disable.
 */
function usePollingEffect(
  fetchData: () => void | Promise<void>,
  interval: number | null | undefined
): void {
  useEffect(() => {
    if (!interval || interval <= 0) return;
    if (typeof document === 'undefined') return;

    const handle = setInterval(() => {
      if (!document.hidden) void fetchData();
    }, interval);

    const onVisibility = () => {
      if (!document.hidden) void fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [interval, fetchData]);
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

/**
 * Hook for invitation/referral click stats grouped by invitation_type.
 */
export function useInvitationStats(days: number = 30): {
  stats: InvitationStat[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [stats, setStats] = useState<InvitationStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getInvitationStats(days);
      if (isMounted.current) {
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching invitation stats:', err);
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
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return { stats, loading, error, refetch: fetchData };
}

/**
 * Hook for top target_id values within a single invitation_type.
 * Pass `null` to skip the fetch (no type selected for drill-down).
 */
export function useInvitationTopTargets(
  invitationType: InvitationType | null,
  days: number = 30,
  limit: number = 5
): {
  targets: InvitationTopTarget[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [targets, setTargets] = useState<InvitationTopTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    if (!invitationType) {
      setTargets([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await getInvitationTopTargets(invitationType, days, limit);
      if (isMounted.current) {
        setTargets(data);
      }
    } catch (err) {
      console.error('Error fetching invitation top targets:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [invitationType, days, limit]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationType, days, limit]);

  return { targets, loading, error, refetch: fetchData };
}

/**
 * Hook for daily invitation-click time-series, grouped by invitation_type.
 */
export function useInvitationTimeseries(days: number = 30): {
  data: InvitationTimeseries;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<InvitationTimeseries>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getInvitationTimeseries(days);
      if (isMounted.current) {
        setData(result);
      }
    } catch (err) {
      console.error('Error fetching invitation timeseries:', err);
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
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Hook for resolving raw target_id values to friendly entity names.
 * Re-fetches when invitationType changes or when the joined targetIds string changes.
 */
export function useInvitationTargetNames(
  invitationType: InvitationType | null,
  targetIds: string[]
): {
  names: Map<string, string>;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);
  const idsKey = targetIds.join('|');

  const fetchData = useCallback(async () => {
    if (!invitationType || targetIds.length === 0) {
      setNames(new Map());
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await resolveInvitationTargets(invitationType, targetIds);
      if (isMounted.current) {
        setNames(result);
      }
    } catch (err) {
      console.error('Error resolving invitation target names:', err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationType, idsKey]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationType, idsKey]);

  return { names, loading, error, refetch: fetchData };
}

// =============================================================================
// UTM ATTRIBUTION HOOKS
// =============================================================================

export interface UtmLandingsResponse {
  window: '24h' | '7d' | '30d' | '90d';
  landings: { source: string; medium: string; campaign: string; count: number }[];
  timeseries: { day: string; campaign: string; landings: number }[];
  totals: { landings: number; uniqueVisitors: number };
  /** Only present when the request was made with compare=true */
  previousTotals?: { landings: number; uniqueVisitors: number };
}

interface PollingOptions {
  /** Polling interval in ms; pass `null` or `0` to disable */
  refetchInterval?: number | null;
  /** Append `?demo=1` to the request — server returns synthetic data in non-prod */
  demo?: boolean;
  /** Append `?compare=1` to the landings request — server returns previousTotals */
  compare?: boolean;
}

/**
 * Hook for pre-signup UTM landings, sourced from PostHog via the admin API
 * route (server runs HogQL). Polls when `refetchInterval` is set, so the
 * Acquisition tab can be used as a live monitor during a campaign push.
 */
export function useUtmLandings(
  window: '24h' | '7d' | '30d' | '90d',
  options: PollingOptions = {}
): {
  data: UtmLandingsResponse | null;
  loading: boolean;
  error: Error | null;
  lastFetchedAt: number | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<UtmLandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const isMounted = useRef(true);

  const demo = options.demo ?? false;
  const compare = options.compare ?? false;
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = `/api/admin/analytics/utm?window=${window}${demo ? '&demo=1' : ''}${compare ? '&compare=1' : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`UTM landings request failed: ${res.status}`);
      const json = (await res.json()) as UtmLandingsResponse;
      if (isMounted.current) {
        setData(json);
        setLastFetchedAt(Date.now());
      }
    } catch (err) {
      console.error('Error fetching UTM landings:', err);
      if (isMounted.current) setError(err as Error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [window, demo, compare]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, demo, compare]);

  usePollingEffect(fetchData, options.refetchInterval);

  return { data, loading, error, lastFetchedAt, refetch: fetchData };
}

/**
 * Period-over-period totals for the UTM KPI strip — current window vs the
 * matched-length previous window. Polls when `refetchInterval` is set.
 */
export function useUtmTotalsComparison(
  days: number,
  options: { refetchInterval?: number | null } = {}
): {
  data: UtmTotalsComparison | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<UtmTotalsComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getUtmTotalsComparison(days);
      if (isMounted.current) setData(result);
    } catch (err) {
      if (isMounted.current) setError(err as Error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  usePollingEffect(fetchData, options.refetchInterval);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Hook for signup-and-downstream UTM stats, sourced from Supabase via
 * `get_utm_signup_stats`. Same polling shape as `useUtmLandings`.
 */
export function useUtmSignupStats(
  days: number,
  options: PollingOptions = {}
): {
  stats: UtmSignupStat[];
  loading: boolean;
  error: Error | null;
  lastFetchedAt: number | null;
  refetch: () => Promise<void>;
} {
  const [stats, setStats] = useState<UtmSignupStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getUtmSignupStats(days);
      if (isMounted.current) {
        setStats(result);
        setLastFetchedAt(Date.now());
      }
    } catch (err) {
      console.error('Error fetching UTM signup stats:', err);
      if (isMounted.current) setError(err as Error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  usePollingEffect(fetchData, options.refetchInterval);

  return { stats, loading, error, lastFetchedAt, refetch: fetchData };
}

/**
 * Hook for the admin-managed UTM campaign catalog. Returns the active
 * campaigns plus mutators (create/archive) so the link-builder UI can
 * manage the list inline. Refetches automatically after a successful
 * create or archive.
 */
export function useUtmCampaigns(): {
  campaigns: UtmCampaign[];
  loading: boolean;
  error: Error | null;
  create: (params: {
    slug: string;
    displayName: string;
    description?: string;
  }) => Promise<{ id: string | null; error: string | null }>;
  archive: (id: string) => Promise<{ error: string | null }>;
  refetch: () => Promise<void>;
} {
  const [campaigns, setCampaigns] = useState<UtmCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUtmCampaigns(false);
      if (isMounted.current) setCampaigns(data);
    } catch (err) {
      if (isMounted.current) setError(err as Error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
  }, [fetchData]);

  const create = useCallback(
    async (params: { slug: string; displayName: string; description?: string }) => {
      const result = await createUtmCampaign(params);
      if (!result.error) await fetchData();
      return result;
    },
    [fetchData]
  );

  const archive = useCallback(
    async (id: string) => {
      const result = await archiveUtmCampaign(id);
      if (!result.error) await fetchData();
      return result;
    },
    [fetchData]
  );

  return { campaigns, loading, error, create, archive, refetch: fetchData };
}

// =============================================================================
// MATCH FILL ANALYTICS
// =============================================================================

export function useMatchFillAnalytics(days: number = 30): {
  data: MatchFillPoint[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<MatchFillPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const endDate = new Date();
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await getMatchFillAnalytics(startDate, endDate);
      if (isMounted.current) setData(result);
    } catch (err) {
      console.error('Error fetching match fill analytics:', err);
      if (isMounted.current) setError(err as Error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    isMounted.current = true;
    fetchData();
    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return { data, loading, error, refetch: fetchData };
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
  InvitationStat,
  InvitationTopTarget,
  InvitationType,
  InvitationTimeseries,
  InvitationTimeseriesPoint,
  UtmSignupStat,
  UtmCampaign,
  UtmTotalsComparison,
  MatchFillPoint,
} from '@rallia/shared-services';

export default useAdminAnalytics;
