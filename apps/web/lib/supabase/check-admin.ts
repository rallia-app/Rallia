import * as Sentry from '@sentry/nextjs';

import { createClient } from '@/lib/supabase/server';

/**
 * Thrown when the admin-role lookup itself fails (network/DB error), as
 * opposed to a genuine "no admin row". Callers must not treat this as
 * "not an admin": API routes should return 503, page guards should let it
 * propagate to the error boundary instead of redirecting.
 */
export class AdminCheckError extends Error {
  constructor(public readonly cause: unknown) {
    super('Admin role lookup failed');
    this.name = 'AdminCheckError';
  }
}

// PGRST116 = .single() found no rows: the legit "not an admin" case.
function assertQuerySucceeded(error: { code?: string } | null): void {
  if (error && error.code !== 'PGRST116') {
    const checkError = new AdminCheckError(error);
    Sentry.captureException(checkError);
    throw checkError;
  }
}

/**
 * Check if a user is an admin (Rallia employee/manager)
 *
 * Checks the `admins` table to see if the user has an admin role.
 * The `admins` table references `profiles.id`, which in turn references `auth_users.id`.
 *
 * Schema:
 * - auth_users.id (Supabase auth user ID)
 * - profiles.id (references auth_users.id)
 * - admins.id (references profiles.id)
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  // Check if user exists in the admins table
  // The userId is the auth_users.id, which matches profiles.id
  // and admins.id references profiles.id
  const { data: admin, error } = await supabase
    .from('admin')
    .select('id, role')
    .eq('id', userId)
    .single();

  assertQuerySucceeded(error);

  // No admin record found, user is not a platform admin
  if (!admin) {
    return false;
  }

  // User has an admin record, so they are a platform admin
  return true;
}

/**
 * Get the admin role for a user
 *
 * Returns the admin role enum value if the user is an admin, null otherwise.
 */
export async function getAdminRole(userId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: admin, error } = await supabase
    .from('admin')
    .select('role')
    .eq('id', userId)
    .single();

  assertQuerySucceeded(error);

  if (!admin) {
    return null;
  }

  return admin.role;
}

/**
 * Check if a user is a super admin
 *
 * Returns true if the user is a super admin, false otherwise.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data: admin, error } = await supabase
    .from('admin')
    .select('role')
    .eq('id', userId)
    .single();

  assertQuerySucceeded(error);

  if (!admin) {
    return false;
  }

  return admin.role === 'super_admin';
}

/**
 * Check if a user's admin role is in a list of allowed roles.
 * super_admin always passes regardless of allowedRoles.
 *
 * Returns the role if allowed, or { allowed: false } if not.
 * Throws AdminCheckError if the lookup fails — API routes map it to a 503.
 */
export async function requireApiRole(
  userId: string,
  allowedRoles: string[]
): Promise<{ allowed: boolean; role: string | null }> {
  const role = await getAdminRole(userId);
  if (!role) return { allowed: false, role: null };
  if (role === 'super_admin') return { allowed: true, role };
  return { allowed: allowedRoles.includes(role), role };
}
