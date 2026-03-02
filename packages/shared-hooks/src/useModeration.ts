/**
 * useModeration Hook
 *
 * Custom hooks for admin moderation functionality.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  moderationService,
  type PlayerReport,
  type PlayerBan,
  type ReportCounts,
  type ReportFilters,
  type BanFilters,
  type ReportStatus,
  type CreateBanParams,
} from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseReportsOptions {
  autoFetch?: boolean;
  filters?: ReportFilters;
  pageSize?: number;
}

export interface UseReportsResult {
  reports: PlayerReport[];
  counts: ReportCounts;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (filters: ReportFilters) => void;
  dismissReport: (reportId: string, reason?: string) => Promise<boolean>;
  escalateReport: (reportId: string, notes?: string) => Promise<boolean>;
  reviewReport: (
    reportId: string,
    status: ReportStatus,
    actionTaken?: string,
    notes?: string
  ) => Promise<boolean>;
}

export interface UseBansOptions {
  autoFetch?: boolean;
  filters?: BanFilters;
  pageSize?: number;
}

export interface UseBansResult {
  bans: PlayerBan[];
  activeBansCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (filters: BanFilters) => void;
  createBan: (params: CreateBanParams) => Promise<PlayerBan | null>;
  revokeBan: (banId: string, reason?: string) => Promise<boolean>;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook for managing player reports
 */
export function useReports(options: UseReportsOptions = {}): UseReportsResult {
  const { autoFetch = true, filters: initialFilters = {}, pageSize = 20 } = options;

  const [reports, setReports] = useState<PlayerReport[]>([]);
  const [counts, setCounts] = useState<ReportCounts>({
    total: 0,
    pending: 0,
    under_review: 0,
    high_priority: 0,
  });
  const [filters, setFilters] = useState<ReportFilters>(initialFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const adminIdRef = useRef<string | null>(null);

  // Get admin ID on mount
  useEffect(() => {
    import('@rallia/shared-services').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        adminIdRef.current = data.user?.id || null;
      });
    });
  }, []);

  // Fetch reports
  const fetchReports = useCallback(
    async (reset = false) => {
      if (reset) {
        setIsLoading(true);
        offsetRef.current = 0;
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const [newReports, newCounts] = await Promise.all([
          moderationService.getPlayerReports(filters, pageSize, offsetRef.current),
          reset ? moderationService.getPendingReportsCount() : Promise.resolve(counts),
        ]);

        if (reset) {
          setReports(newReports);
          setCounts(newCounts);
        } else {
          setReports(prev => [...prev, ...newReports]);
        }

        setHasMore(newReports.length === pageSize);
        offsetRef.current += newReports.length;
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [filters, pageSize, counts]
  );

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchReports(true);
    }
  }, [autoFetch, filters]);

  // Refetch
  const refetch = useCallback(async () => {
    await fetchReports(true);
  }, [fetchReports]);

  // Load more
  const loadMore = useCallback(async () => {
    if (!isLoading && !isLoadingMore && hasMore) {
      await fetchReports(false);
    }
  }, [fetchReports, isLoading, isLoadingMore, hasMore]);

  // Dismiss report
  const dismissReport = useCallback(
    async (reportId: string, reason?: string): Promise<boolean> => {
      if (!adminIdRef.current) return false;
      const success = await moderationService.dismissReport(reportId, adminIdRef.current, reason);
      if (success) {
        setReports(prev =>
          prev.map(r => (r.id === reportId ? { ...r, status: 'dismissed' as ReportStatus } : r))
        );
        setCounts(prev => ({
          ...prev,
          pending: Math.max(0, prev.pending - 1),
          total: Math.max(0, prev.total - 1),
        }));
      }
      return success;
    },
    []
  );

  // Escalate report
  const escalateReport = useCallback(
    async (reportId: string, notes?: string): Promise<boolean> => {
      if (!adminIdRef.current) return false;
      const success = await moderationService.escalateReport(reportId, adminIdRef.current, notes);
      if (success) {
        setReports(prev =>
          prev.map(r => (r.id === reportId ? { ...r, status: 'escalated' as ReportStatus } : r))
        );
      }
      return success;
    },
    []
  );

  // Review report
  const reviewReport = useCallback(
    async (
      reportId: string,
      status: ReportStatus,
      actionTaken?: string,
      notes?: string
    ): Promise<boolean> => {
      if (!adminIdRef.current) return false;
      const success = await moderationService.reviewReport({
        reportId,
        adminId: adminIdRef.current,
        status,
        actionTaken,
        adminNotes: notes,
      });
      if (success) {
        setReports(prev => prev.map(r => (r.id === reportId ? { ...r, status } : r)));
        if (status === 'dismissed' || status === 'action_taken') {
          setCounts(prev => ({
            ...prev,
            pending: Math.max(0, prev.pending - 1),
            total: Math.max(0, prev.total - 1),
          }));
        }
      }
      return success;
    },
    []
  );

  return {
    reports,
    counts,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    refetch,
    loadMore,
    setFilters,
    dismissReport,
    escalateReport,
    reviewReport,
  };
}

/**
 * Hook for managing player bans
 */
export function useBans(options: UseBansOptions = {}): UseBansResult {
  const { autoFetch = true, filters: initialFilters = {}, pageSize = 20 } = options;

  const [bans, setBans] = useState<PlayerBan[]>([]);
  const [activeBansCount, setActiveBansCount] = useState(0);
  const [filters, setFilters] = useState<BanFilters>(initialFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const adminIdRef = useRef<string | null>(null);

  // Get admin ID on mount
  useEffect(() => {
    import('@rallia/shared-services').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        adminIdRef.current = data.user?.id || null;
      });
    });
  }, []);

  // Fetch bans
  const fetchBans = useCallback(
    async (reset = false) => {
      if (reset) {
        setIsLoading(true);
        offsetRef.current = 0;
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const [newBans, count] = await Promise.all([
          moderationService.getPlayerBans(filters, pageSize, offsetRef.current),
          reset ? moderationService.getActiveBansCount() : Promise.resolve(activeBansCount),
        ]);

        if (reset) {
          setBans(newBans);
          setActiveBansCount(count);
        } else {
          setBans(prev => [...prev, ...newBans]);
        }

        setHasMore(newBans.length === pageSize);
        offsetRef.current += newBans.length;
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [filters, pageSize, activeBansCount]
  );

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchBans(true);
    }
  }, [autoFetch, filters]);

  // Refetch
  const refetch = useCallback(async () => {
    await fetchBans(true);
  }, [fetchBans]);

  // Load more
  const loadMore = useCallback(async () => {
    if (!isLoading && !isLoadingMore && hasMore) {
      await fetchBans(false);
    }
  }, [fetchBans, isLoading, isLoadingMore, hasMore]);

  // Create ban
  const createBan = useCallback(async (params: CreateBanParams): Promise<PlayerBan | null> => {
    if (!adminIdRef.current) return null;
    const ban = await moderationService.createBan(adminIdRef.current, params);
    if (ban) {
      setBans(prev => [ban, ...prev]);
      setActiveBansCount(prev => prev + 1);
    }
    return ban;
  }, []);

  // Revoke ban
  const revokeBan = useCallback(async (banId: string, reason?: string): Promise<boolean> => {
    if (!adminIdRef.current) return false;
    const success = await moderationService.revokeBan(banId, adminIdRef.current, reason);
    if (success) {
      setBans(prev => prev.map(b => (b.id === banId ? { ...b, is_active: false } : b)));
      setActiveBansCount(prev => Math.max(0, prev - 1));
    }
    return success;
  }, []);

  return {
    bans,
    activeBansCount,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    refetch,
    loadMore,
    setFilters,
    createBan,
    revokeBan,
  };
}

/**
 * Hook for report counts only (lightweight)
 */
export function useReportCounts(): {
  counts: ReportCounts;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const [counts, setCounts] = useState<ReportCounts>({
    total: 0,
    pending: 0,
    under_review: 0,
    high_priority: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const newCounts = await moderationService.getPendingReportsCount();
      setCounts(newCounts);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return { counts, isLoading, refetch: fetchCounts };
}

// Re-export types for convenience
export type {
  PlayerReport,
  PlayerBan,
  ReportCounts,
  ReportFilters,
  BanFilters,
  ReportStatus,
  ReportType,
  ReportPriority,
  BanType,
  CreateBanParams,
} from '@rallia/shared-services';
