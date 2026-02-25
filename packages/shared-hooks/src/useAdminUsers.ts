/**
 * useAdminUsers Hook
 *
 * Provides admin-level user management capabilities including
 * fetching, searching, filtering, and paginating users.
 *
 * @example
 * ```tsx
 * const { users, loading, error, hasMore, loadMore, refetch } = useAdminUsers({
 *   filters: { status: 'active', searchQuery: 'john' }
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAdminUsers,
  fetchAdminUserDetail,
  type AdminUserInfo,
  type AdminUserDetail,
  type AdminUserFilters,
} from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseAdminUsersOptions {
  /** Initial filters */
  filters?: AdminUserFilters;
  /** Page size */
  pageSize?: number;
  /** Sort field */
  sortBy?: 'created_at' | 'last_sign_in_at' | 'display_name';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseAdminUsersResult {
  /** List of users */
  users: AdminUserInfo[];
  /** Total count of users matching filters */
  totalCount: number;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Whether there are more users to load */
  hasMore: boolean;
  /** Load more users (pagination) */
  loadMore: () => Promise<void>;
  /** Refetch users with current filters */
  refetch: () => Promise<void>;
  /** Update filters and refetch */
  setFilters: (filters: AdminUserFilters) => void;
  /** Current filters */
  filters: AdminUserFilters;
}

export interface UseAdminUserDetailOptions {
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

export interface UseAdminUserDetailResult {
  /** User detail */
  user: AdminUserDetail | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch user detail */
  refetch: () => Promise<void>;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to fetch and manage admin user list
 */
export function useAdminUsers(options: UseAdminUsersOptions = {}): UseAdminUsersResult {
  const {
    filters: initialFilters = {},
    pageSize = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    autoFetch = true,
  } = options;

  const [users, setUsers] = useState<AdminUserInfo[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFiltersState] = useState<AdminUserFilters>(initialFilters);

  // Use refs to avoid stale closures in useEffect
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  /**
   * Fetch users with current params
   */
  const fetchUsers = useCallback(
    async (reset: boolean = false) => {
      try {
        setLoading(true);
        setError(null);

        const currentOffset = reset ? 0 : offsetRef.current;

        const result = await fetchAdminUsers({
          offset: currentOffset,
          limit: pageSize,
          filters,
          sortBy,
          sortOrder,
        });

        if (reset) {
          setUsers(result.users);
        } else {
          setUsers(prev => [...prev, ...result.users]);
        }

        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
        setOffset(result.nextOffset || currentOffset + pageSize);
      } catch (err) {
        console.error('Error fetching admin users:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    },
    [filters, pageSize, sortBy, sortOrder]
  );

  /**
   * Load more users (pagination)
   */
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    await fetchUsers(false);
  }, [hasMore, loading, fetchUsers]);

  /**
   * Refetch users with current filters
   */
  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchUsers(true);
  }, [fetchUsers]);

  /**
   * Update filters and refetch
   */
  const setFilters = useCallback((newFilters: AdminUserFilters) => {
    setFiltersState(newFilters);
    setOffset(0);
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetchUsers(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Refetch when filters change
  useEffect(() => {
    if (autoFetch) {
      fetchUsers(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]); // Refetch when filters change

  return {
    users,
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
 * Hook to fetch single user detail for admin view
 */
export function useAdminUserDetail(
  userId: string | undefined,
  options: UseAdminUserDetailOptions = {}
): UseAdminUserDetailResult {
  const { autoFetch = true } = options;

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch user detail
   */
  const fetchUser = useCallback(async () => {
    if (!userId) {
      setUser(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await fetchAdminUserDetail(userId);
      setUser(result);
    } catch (err) {
      console.error('Error fetching user detail:', err);
      setError(err as Error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * Refetch user detail
   */
  const refetch = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch && userId) {
      fetchUser();
    }
  }, [autoFetch, userId, fetchUser]);

  return {
    user,
    loading,
    error,
    refetch,
  };
}

// Re-export types for convenience
export type {
  AdminUserInfo,
  AdminUserDetail,
  AdminUserFilters,
  AdminUserStatus,
  AdminBanInfo,
  AdminSportProfile,
  AdminMatchSummary,
  AdminAuditLogEntry,
  BanUserParams,
} from '@rallia/shared-services';

// Re-export functions for convenience
export {
  banUser,
  unbanUser,
  getActivePlayerBan,
  getPlayerBanHistory,
} from '@rallia/shared-services';

export default useAdminUsers;
