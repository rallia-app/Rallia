/**
 * useAdminNetworks Hook
 *
 * Provides admin-level network management capabilities including
 * fetching, searching, filtering networks (groups & communities),
 * and certifying communities.
 *
 * @example
 * ```tsx
 * const { networks, loading, error, hasMore, loadMore, refetch } = useAdminNetworks({
 *   filters: { networkType: 'community', searchQuery: 'tennis' }
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAdminNetworks,
  fetchAdminNetworkDetail,
  certifyNetwork,
  deleteNetwork,
  getNetworkLimits,
  updateNetworkLimits,
  type AdminNetworkInfo,
  type AdminNetworkDetail,
  type AdminNetworkFilters,
  type NetworkLimits,
  type DeleteNetworkResult,
} from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseAdminNetworksOptions {
  /** Initial filters */
  filters?: AdminNetworkFilters;
  /** Page size */
  pageSize?: number;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseAdminNetworksResult {
  /** List of networks */
  networks: AdminNetworkInfo[];
  /** Total count of networks matching filters */
  totalCount: number;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Whether there are more networks to load */
  hasMore: boolean;
  /** Load more networks (pagination) */
  loadMore: () => Promise<void>;
  /** Refetch networks with current filters */
  refetch: () => Promise<void>;
  /** Update filters and refetch */
  setFilters: (filters: AdminNetworkFilters) => void;
  /** Current filters */
  filters: AdminNetworkFilters;
}

export interface UseAdminNetworkDetailOptions {
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseAdminNetworkDetailResult {
  /** Network detail */
  network: AdminNetworkDetail | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch network detail */
  refetch: () => Promise<void>;
}

export interface UseCertifyNetworkResult {
  /** Certify the network */
  certify: (
    networkId: string,
    isCertified: boolean,
    notes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
}

export interface UseNetworkLimitsResult {
  /** Network limits setting */
  limits: NetworkLimits | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Update limits */
  updateLimits: (limits: NetworkLimits) => Promise<{ success: boolean; error?: string }>;
  /** Refetch limits */
  refetch: () => Promise<void>;
}

export interface UseDeleteNetworkResult {
  /** Delete a network */
  deleteNetworkFn: (networkId: string, reason?: string) => Promise<DeleteNetworkResult>;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to fetch and manage admin network list
 */
export function useAdminNetworks(options: UseAdminNetworksOptions = {}): UseAdminNetworksResult {
  const { filters: initialFilters = {}, pageSize = 20, autoFetch = true } = options;

  const [networks, setNetworks] = useState<AdminNetworkInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFiltersState] = useState<AdminNetworkFilters>(initialFilters);

  // Use refs to avoid stale closures in useEffect
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  /**
   * Fetch networks with current params
   */
  const fetchNetworks = useCallback(
    async (reset: boolean = false) => {
      try {
        setLoading(true);
        setError(null);

        const currentOffset = reset ? 0 : offsetRef.current;

        const result = await fetchAdminNetworks({
          offset: currentOffset,
          limit: pageSize,
          filters,
        });

        if (reset) {
          setNetworks(result.networks);
          setOffset(result.networks.length);
        } else {
          setNetworks(prev => [...prev, ...result.networks]);
          setOffset(prev => prev + result.networks.length);
        }

        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
      } catch (err) {
        console.error('Error fetching admin networks:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    },
    [pageSize, filters]
  );

  /**
   * Load more networks (pagination)
   */
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    await fetchNetworks(false);
  }, [loading, hasMore, fetchNetworks]);

  /**
   * Refetch networks from beginning
   */
  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchNetworks(true);
  }, [fetchNetworks]);

  /**
   * Update filters and refetch
   */
  const setFilters = useCallback((newFilters: AdminNetworkFilters) => {
    setFiltersState(newFilters);
    setOffset(0);
  }, []);

  // Auto-fetch on mount and when filters change
  useEffect(() => {
    if (autoFetch) {
      fetchNetworks(true);
    }
  }, [autoFetch, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    networks,
    totalCount,
    loading,
    error,
    hasMore,
    loadMore,
    refetch,
    setFilters,
    filters,
  };
}

/**
 * Hook to fetch admin network detail
 */
export function useAdminNetworkDetail(
  networkId: string | null,
  options: UseAdminNetworkDetailOptions = {}
): UseAdminNetworkDetailResult {
  const { autoFetch = true } = options;

  const [network, setNetwork] = useState<AdminNetworkDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!networkId) {
      setNetwork(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await fetchAdminNetworkDetail(networkId);
      setNetwork(result);
    } catch (err) {
      console.error('Error fetching admin network detail:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [networkId]);

  const refetch = useCallback(async () => {
    await fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (autoFetch && networkId) {
      fetchDetail();
    }
  }, [autoFetch, networkId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    network,
    loading,
    error,
    refetch,
  };
}

/**
 * Hook to certify/uncertify a network
 */
export function useCertifyNetwork(): UseCertifyNetworkResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const certify = useCallback(
    async (
      networkId: string,
      isCertified: boolean,
      notes?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        setLoading(true);
        setError(null);

        const result = await certifyNetwork({
          networkId,
          isCertified,
          notes,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to certify network');
        }

        return { success: true };
      } catch (err) {
        console.error('Error certifying network:', err);
        const errorObj = err instanceof Error ? err : new Error('Unknown error');
        setError(errorObj);
        return { success: false, error: errorObj.message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    certify,
    loading,
    error,
  };
}

/**
 * Hook to manage network limits setting
 */
export function useNetworkLimits(): UseNetworkLimitsResult {
  const [limits, setLimits] = useState<NetworkLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchLimits = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getNetworkLimits();
      setLimits(result);
    } catch (err) {
      console.error('Error fetching network limits:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  const updateLimitsHandler = useCallback(
    async (newLimits: NetworkLimits): Promise<{ success: boolean; error?: string }> => {
      try {
        setLoading(true);
        setError(null);

        const result = await updateNetworkLimits(newLimits);

        if (!result.success) {
          throw new Error(result.error || 'Failed to update limits');
        }

        setLimits(newLimits);
        return { success: true };
      } catch (err) {
        console.error('Error updating network limits:', err);
        const errorObj = err instanceof Error ? err : new Error('Unknown error');
        setError(errorObj);
        return { success: false, error: errorObj.message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refetch = useCallback(async () => {
    await fetchLimits();
  }, [fetchLimits]);

  useEffect(() => {
    fetchLimits();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    limits,
    loading,
    error,
    updateLimits: updateLimitsHandler,
    refetch,
  };
}

/**
 * Hook to delete a network as admin
 */
export function useDeleteNetwork(): UseDeleteNetworkResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deleteNetworkFn = useCallback(
    async (networkId: string, reason?: string): Promise<DeleteNetworkResult> => {
      try {
        setLoading(true);
        setError(null);

        const result = await deleteNetwork({
          networkId,
          reason,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to delete network');
        }

        return result;
      } catch (err) {
        console.error('Error deleting network:', err);
        const errorObj = err instanceof Error ? err : new Error('Unknown error');
        setError(errorObj);
        return { success: false, error: errorObj.message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    deleteNetworkFn,
    loading,
    error,
  };
}

// =============================================================================
// RE-EXPORT TYPES
// =============================================================================

export type {
  AdminNetworkInfo,
  AdminNetworkDetail,
  AdminNetworkFilters,
  AdminNetworkType,
  AdminNetworkMember,
  AdminNetworkFacility,
  NetworkLimits,
  DeleteNetworkResult,
} from '@rallia/shared-services';
