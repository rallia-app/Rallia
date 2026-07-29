/**
 * useAdminStatus Hook
 *
 * Provides admin status and role information for the current authenticated user.
 * Checks the `admin` table in Supabase to determine if user has admin privileges.
 *
 * Admin Roles:
 * - super_admin: Full system access, can manage other admins
 * - moderator: User management, content moderation
 * - support: User support, read-only analytics
 * - analyst: Analytics and reporting only (read-only)
 *
 * @example
 * ```tsx
 * const { isAdmin, role, permissions, loading } = useAdminStatus();
 *
 * if (loading) return <Spinner />;
 *
 * if (isAdmin) {
 *   return <AdminPanel role={role} />;
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase as sharedSupabase } from '@rallia/shared-services';
import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

/** Admin role types matching the database enum */
export type AdminRole = 'super_admin' | 'moderator' | 'support' | 'analyst';

/** Admin permissions structure from JSONB column */
export interface AdminPermissions {
  users?: {
    read?: boolean;
    write?: boolean;
    ban?: boolean;
  };
  analytics?: {
    read?: boolean;
    export?: boolean;
  };
  notifications?: {
    send?: boolean;
  };
  audit?: {
    read?: boolean;
  };
  admins?: {
    manage?: boolean;
  };
  [key: string]: unknown;
}

/** Admin status return type */
export interface AdminStatus {
  /** Whether the user is an admin */
  isAdmin: boolean;
  /** The admin's ID (same as user ID), null if not an admin */
  adminId: string | null;
  /** The user's admin role, null if not an admin */
  role: AdminRole | null;
  /** Custom permissions from JSONB, null if not an admin */
  permissions: AdminPermissions | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch admin status */
  refetch: () => Promise<void>;
}

/** Options for the useAdminStatus hook */
export interface UseAdminStatusOptions {
  /** Custom Supabase client (for SSR or testing) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: SupabaseClient<any, any, any>;
  /** User ID to check. If not provided, checks current authenticated user */
  userId?: string;
}

// =============================================================================
// DEFAULT PERMISSIONS BY ROLE
// =============================================================================

const DEFAULT_PERMISSIONS: Record<AdminRole, AdminPermissions> = {
  super_admin: {
    users: { read: true, write: true, ban: true },
    analytics: { read: true, export: true },
    notifications: { send: true },
    audit: { read: true },
    admins: { manage: true },
  },
  moderator: {
    users: { read: true, write: true, ban: true },
    analytics: { read: true, export: false },
    notifications: { send: true },
    audit: { read: true },
    admins: { manage: false },
  },
  support: {
    users: { read: true, write: false, ban: false },
    analytics: { read: true, export: false },
    notifications: { send: false },
    audit: { read: false },
    admins: { manage: false },
  },
  analyst: {
    users: { read: true, write: false, ban: false },
    analytics: { read: true, export: true },
    notifications: { send: false },
    audit: { read: false },
    admins: { manage: false },
  },
};

// =============================================================================
// MODULE-LEVEL CACHE
// =============================================================================

/**
 * Admin status barely changes, but this hook is mounted on Home, Community,
 * Tournaments, Leagues, Settings, header buttons and more — the previous
 * implementation re-ran a network `auth.getUser()` plus an `admin` select on
 * EVERY mount, which head-of-line-blocked the auth lock during navigation.
 * A module-level cache (5 min TTL, in-flight dedup) means one cheap fetch
 * shared by every mount, with no QueryClientProvider requirement so the hook
 * keeps working in the web admin views.
 */

interface AdminStatusData {
  adminId: string | null;
  role: AdminRole | null;
  permissions: AdminPermissions | null;
}

const NOT_ADMIN: AdminStatusData = { adminId: null, role: null, permissions: null };
const ADMIN_STATUS_TTL_MS = 5 * 60 * 1000;

const adminStatusCache = new Map<string, { data: AdminStatusData; fetchedAt: number }>();
const adminStatusInflight = new Map<string, Promise<AdminStatusData>>();
const adminStatusSubscribers = new Set<() => void>();

function notifyAdminStatusSubscribers() {
  adminStatusSubscribers.forEach(fn => fn());
}

/** Exposed for tests and for auth flows that must force a fresh check. */
export function clearAdminStatusCache() {
  adminStatusCache.clear();
  notifyAdminStatusSubscribers();
}

async function fetchAdminStatusData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  userId: string | undefined
): Promise<AdminStatusData> {
  let targetUserId = userId;

  if (!targetUserId) {
    // Local session read (memory/storage) — deliberately NOT the network
    // round-trip of auth.getUser(); the admin table lookup below is what
    // actually authorizes anything, and RLS re-validates server-side.
    const {
      data: { session },
    } = await client.auth.getSession();

    if (!session?.user) {
      return NOT_ADMIN;
    }

    targetUserId = session.user.id;
  }

  const { data: adminData, error: adminError } = await client
    .from('admin')
    .select('role, permissions')
    .eq('id', targetUserId)
    .maybeSingle();

  if (adminError) {
    throw new Error(adminError.message);
  }

  if (!adminData) {
    return NOT_ADMIN;
  }

  const adminRole = adminData.role as AdminRole;
  const defaultPerms = DEFAULT_PERMISSIONS[adminRole] || {};
  const customPerms = (adminData.permissions as AdminPermissions) || {};
  return {
    adminId: targetUserId,
    role: adminRole,
    permissions: { ...defaultPerms, ...customPerms },
  };
}

function loadAdminStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  userId: string | undefined,
  force: boolean
): Promise<AdminStatusData> {
  const key = userId ?? 'self';

  if (!force) {
    const cached = adminStatusCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ADMIN_STATUS_TTL_MS) {
      return Promise.resolve(cached.data);
    }
    const inflight = adminStatusInflight.get(key);
    if (inflight) {
      return inflight;
    }
  }

  const promise = fetchAdminStatusData(client, userId)
    .then(data => {
      adminStatusCache.set(key, { data, fetchedAt: Date.now() });
      adminStatusInflight.delete(key);
      notifyAdminStatusSubscribers();
      return data;
    })
    .catch(err => {
      adminStatusInflight.delete(key);
      throw err;
    });

  adminStatusInflight.set(key, promise);
  return promise;
}

/** Internal seams exposed for unit tests only — not part of the public API. */
export const __adminStatusInternals = {
  loadAdminStatus,
  fetchAdminStatusData,
  cache: adminStatusCache,
  inflight: adminStatusInflight,
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to check admin status and role for current or specified user.
 *
 * @param options - Configuration options
 * @returns Admin status object with role, permissions, and loading state
 */
export function useAdminStatus(options?: UseAdminStatusOptions): AdminStatus {
  const supabase = useMemo(() => options?.client ?? sharedSupabase, [options?.client]);
  const cacheKey = options?.userId ?? 'self';

  const cachedEntry = adminStatusCache.get(cacheKey);
  const isCacheFresh = !!cachedEntry && Date.now() - cachedEntry.fetchedAt < ADMIN_STATUS_TTL_MS;

  const [data, setData] = useState<AdminStatusData | null>(isCacheFresh ? cachedEntry.data : null);
  const [loading, setLoading] = useState(!isCacheFresh);
  const [error, setError] = useState<Error | null>(null);

  const fetchAdminStatus = useCallback(
    async (force = true) => {
      try {
        const result = await loadAdminStatus(supabase, options?.userId, force);
        setData(result);
        setError(null);
      } catch (err) {
        console.error('Error fetching admin status:', err);
        setError(err as Error);
        setData(NOT_ADMIN);
      } finally {
        setLoading(false);
      }
    },
    [supabase, options?.userId]
  );

  // Initial fetch (cache/in-flight dedup makes this a no-op when fresh) and
  // subscription so every mounted instance reflects cache updates.
  useEffect(() => {
    void fetchAdminStatus(false);

    const onCacheChange = () => {
      const entry = adminStatusCache.get(cacheKey);
      if (entry) {
        setData(entry.data);
        setLoading(false);
      } else {
        // Cache was cleared (auth transition) — refetch.
        void fetchAdminStatus(false);
      }
    };
    adminStatusSubscribers.add(onCacheChange);
    return () => {
      adminStatusSubscribers.delete(onCacheChange);
    };
  }, [fetchAdminStatus, cacheKey]);

  // Listen for auth state changes to refetch
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') {
        // Drop the stale entry, then load un-forced so the in-flight dedup
        // collapses the N mounted instances into a single admin query.
        adminStatusCache.delete(cacheKey);
        void fetchAdminStatus(false);
      } else if (event === 'SIGNED_OUT') {
        adminStatusCache.set(cacheKey, { data: NOT_ADMIN, fetchedAt: Date.now() });
        setData(NOT_ADMIN);
        setError(null);
        setLoading(false);
        notifyAdminStatusSubscribers();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, fetchAdminStatus, cacheKey]);

  const refetch = useCallback(async () => {
    await fetchAdminStatus(true);
  }, [fetchAdminStatus]);

  return useMemo(
    () => ({
      isAdmin: !!data?.adminId,
      adminId: data?.adminId ?? null,
      role: data?.role ?? null,
      permissions: data?.permissions ?? null,
      loading,
      error,
      refetch,
    }),
    [data, loading, error, refetch]
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if admin has a specific permission
 *
 * @param permissions - Admin permissions object
 * @param category - Permission category (e.g., 'users', 'analytics')
 * @param action - Permission action (e.g., 'read', 'write')
 * @returns Whether the admin has the permission
 */
export function hasPermission(
  permissions: AdminPermissions | null,
  category: keyof AdminPermissions,
  action: string
): boolean {
  if (!permissions) return false;
  const categoryPerms = permissions[category];
  if (!categoryPerms || typeof categoryPerms !== 'object') return false;
  return (categoryPerms as Record<string, unknown>)[action] === true;
}

/**
 * Check if role is at or above a required level
 * Role hierarchy: super_admin > moderator > support > analyst
 *
 * @param userRole - User's current role
 * @param requiredRole - Minimum required role
 * @returns Whether user role meets requirement
 */
export function hasMinimumRole(userRole: AdminRole | null, requiredRole: AdminRole): boolean {
  if (!userRole) return false;

  const roleHierarchy: Record<AdminRole, number> = {
    super_admin: 4,
    moderator: 3,
    support: 2,
    analyst: 1,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export default useAdminStatus;
