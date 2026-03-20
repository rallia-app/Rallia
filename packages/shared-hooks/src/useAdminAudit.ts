/**
 * Admin Audit Hooks
 *
 * React hooks for accessing audit log and alert data.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  auditService,
  alertService,
  type AuditLogEntry,
  type AuditLogStats,
  type AuditLogFilters,
  type AdminAlert,
  type AlertCounts,
} from '@rallia/shared-services';

// =============================================================================
// AUDIT LOG HOOK
// =============================================================================

export interface UseAuditLogOptions {
  autoFetch?: boolean;
  filters?: AuditLogFilters;
}

export interface UseAuditLogReturn {
  logs: AuditLogEntry[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (filters: AuditLogFilters) => void;
}

export function useAuditLog(options: UseAuditLogOptions = {}): UseAuditLogReturn {
  const { autoFetch = true, filters: initialFilters = {} } = options;
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filters, setFiltersState] = useState<AuditLogFilters>(initialFilters);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const fetchLogs = useCallback(
    async (reset: boolean = true) => {
      setIsLoading(true);
      setError(null);

      try {
        const offset = reset ? 0 : logs.length;
        const limit = filters.limit || 50;

        const data = await auditService.getAuditLog({
          ...filters,
          limit,
          offset,
        });

        if (reset) {
          setLogs(data);
        } else {
          setLogs(prev => [...prev, ...data]);
        }

        setHasMore(data.length === limit);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch audit logs'));
      } finally {
        setIsLoading(false);
      }
    },
    [filters, logs.length]
  );

  const setFilters = useCallback((newFilters: AuditLogFilters) => {
    setFiltersState(newFilters);
    setLogs([]);
    setHasMore(true);
  }, []);

  const loadMore = useCallback(async () => {
    if (!isLoading && hasMore) {
      await fetchLogs(false);
    }
  }, [isLoading, hasMore, fetchLogs]);

  useEffect(() => {
    if (autoFetch) {
      fetchLogs(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, filters]);

  return {
    logs,
    isLoading,
    error,
    hasMore,
    refetch: () => fetchLogs(true),
    loadMore,
    setFilters,
  };
}

// =============================================================================
// AUDIT STATS HOOK
// =============================================================================

export interface UseAuditStatsReturn {
  stats: AuditLogStats | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useAuditStats(days: number = 7): UseAuditStatsReturn {
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await auditService.getAuditLogStats(days);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch audit stats'));
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchStats,
  };
}

// =============================================================================
// ALERTS HOOK
// =============================================================================

export interface UseAdminAlertsOptions {
  adminId: string;
  autoFetch?: boolean;
  includeRead?: boolean;
  limit?: number;
  pollingInterval?: number; // ms, 0 to disable
}

export interface UseAdminAlertsReturn {
  alerts: AdminAlert[];
  counts: AlertCounts;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  markAsRead: (alertId: string) => Promise<boolean>;
  markAllAsRead: () => Promise<number>;
  dismiss: (alertId: string) => Promise<boolean>;
}

export function useAdminAlerts(options: UseAdminAlertsOptions): UseAdminAlertsReturn {
  const {
    adminId,
    autoFetch = true,
    includeRead = false,
    limit = 20,
    pollingInterval = 0,
  } = options;

  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [counts, setCounts] = useState<AlertCounts>({ total: 0, critical: 0, warning: 0, info: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!adminId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [alertsData, countsData] = await Promise.all([
        alertService.getAdminAlerts(adminId, limit, includeRead),
        alertService.getAlertCounts(adminId),
      ]);

      setAlerts(alertsData);
      setCounts(countsData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch alerts'));
    } finally {
      setIsLoading(false);
    }
  }, [adminId, limit, includeRead]);

  const markAsRead = useCallback(
    async (alertId: string): Promise<boolean> => {
      const success = await alertService.markAlertRead(alertId, adminId);
      if (success) {
        setAlerts(prev =>
          prev.map(a =>
            a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a
          )
        );
        setCounts((prev: AlertCounts) => ({
          ...prev,
          total: Math.max(0, prev.total - 1),
        }));
      }
      return success;
    },
    [adminId]
  );

  const markAllAsRead = useCallback(async (): Promise<number> => {
    const count = await alertService.markAllAlertsRead(adminId);
    if (count > 0) {
      setAlerts(prev =>
        prev.map(a => ({ ...a, is_read: true, read_at: new Date().toISOString() }))
      );
      setCounts({ total: 0, critical: 0, warning: 0, info: 0 });
    }
    return count;
  }, [adminId]);

  const dismiss = useCallback(
    async (alertId: string): Promise<boolean> => {
      const success = await alertService.dismissAlert(alertId, adminId);
      if (success) {
        setAlerts(prev => prev.filter(a => a.id !== alertId));
        setCounts((prev: AlertCounts) => ({
          ...prev,
          total: Math.max(0, prev.total - 1),
        }));
      }
      return success;
    },
    [adminId]
  );

  // Initial fetch
  useEffect(() => {
    if (autoFetch && adminId) {
      fetchAlerts();
    }
  }, [autoFetch, adminId, fetchAlerts]);

  // Polling
  useEffect(() => {
    if (pollingInterval > 0 && adminId) {
      const interval = setInterval(fetchAlerts, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [pollingInterval, adminId, fetchAlerts]);

  return {
    alerts,
    counts,
    isLoading,
    error,
    refetch: fetchAlerts,
    markAsRead,
    markAllAsRead,
    dismiss,
  };
}

// =============================================================================
// ALERT COUNTS HOOK (lightweight version)
// =============================================================================

export function useAlertCounts(adminId: string, pollingInterval: number = 60000): AlertCounts {
  const [counts, setCounts] = useState<AlertCounts>({ total: 0, critical: 0, warning: 0, info: 0 });

  useEffect(() => {
    if (!adminId) return;

    const fetchCounts = async () => {
      const data = await alertService.getAlertCounts(adminId);
      setCounts(data);
    };

    fetchCounts();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchCounts, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [adminId, pollingInterval]);

  return counts;
}

// =============================================================================
// ENTITY HISTORY HOOK
// =============================================================================

export interface UseEntityHistoryReturn {
  history: AuditLogEntry[];
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useEntityHistory(
  entityType: string,
  entityId: string,
  limit: number = 20
): UseEntityHistoryReturn {
  const [history, setHistory] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    if (!entityId) return;

    setIsLoading(true);
    try {
      const data = await auditService.getEntityAuditHistory(
        entityType as 'player' | 'match' | 'admin',
        entityId,
        limit
      );
      setHistory(data);
    } catch (err) {
      console.error('[useEntityHistory] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [entityType, entityId, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    isLoading,
    refetch: fetchHistory,
  };
}
