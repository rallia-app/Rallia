import type { AdminRole } from '@rallia/shared-hooks';
import { getAdminRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

/**
 * Server-side guard for admin pages. Fetches auth + role and redirects
 * to /admin/dashboard if the user's role is not in allowedRoles.
 *
 * @returns The user's admin role (guaranteed to be in allowedRoles).
 */
export async function requireAdminRole(allowedRoles: AdminRole[]): Promise<AdminRole> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/admin/sign-in');
  }

  const role = await getAdminRole(user.id);

  if (!role || !allowedRoles.includes(role as AdminRole)) {
    redirect('/admin/dashboard');
  }

  return role as AdminRole;
}
