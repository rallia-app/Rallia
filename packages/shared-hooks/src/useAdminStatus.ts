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

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [permissions, setPermissions] = useState<AdminPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch admin status from database
   */
  const fetchAdminStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Get user ID to check
      let targetUserId = options?.userId;

      if (!targetUserId) {
        // Get current authenticated user
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          // Not authenticated - not an admin
          setIsAdmin(false);
          setAdminId(null);
          setRole(null);
          setPermissions(null);
          setLoading(false);
          return;
        }

        targetUserId = user.id;
      }

      // Check admin table for user
      const { data: adminData, error: adminError } = await supabase
        .from('admin')
        .select('role, permissions')
        .eq('id', targetUserId)
        .maybeSingle();

      if (adminError) {
        throw new Error(adminError.message);
      }

      if (!adminData) {
        // No admin record found - user is not an admin
        setIsAdmin(false);
        setAdminId(null);
        setRole(null);
        setPermissions(null);
      } else {
        // User is an admin
        const adminRole = adminData.role as AdminRole;
        setIsAdmin(true);
        setAdminId(targetUserId);
        setRole(adminRole);

        // Merge default permissions with custom permissions from database
        const defaultPerms = DEFAULT_PERMISSIONS[adminRole] || {};
        const customPerms = (adminData.permissions as AdminPermissions) || {};
        setPermissions({ ...defaultPerms, ...customPerms });
      }
    } catch (err) {
      console.error('Error fetching admin status:', err);
      setError(err as Error);
      setIsAdmin(false);
      setAdminId(null);
      setRole(null);
      setPermissions(null);
    } finally {
      setLoading(false);
    }
  }, [supabase, options?.userId]);

  // Initial fetch
  useEffect(() => {
    fetchAdminStatus();
  }, [fetchAdminStatus]);

  // Listen for auth state changes to refetch
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') {
        fetchAdminStatus();
      } else if (event === 'SIGNED_OUT') {
        setIsAdmin(false);
        setAdminId(null);
        setRole(null);
        setPermissions(null);
        setError(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, fetchAdminStatus]);

  return {
    isAdmin,
    adminId,
    role,
    permissions,
    loading,
    error,
    refetch: fetchAdminStatus,
  };
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
