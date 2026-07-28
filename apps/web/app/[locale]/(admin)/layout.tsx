import type { AdminRole } from '@rallia/shared-hooks';
import { AdminLayoutWrapper } from '@/components/admin-layout-wrapper';
import { getAdminRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const locale = await getLocale();

  // Check if user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // If not authenticated, redirect to admin sign-in
  if (authError || !user) {
    redirect(`/${locale}/admin/sign-in`);
  }

  // Check if user is an admin and get their role. A failed lookup throws
  // AdminCheckError to the error boundary rather than redirecting out.
  const role = await getAdminRole(user.id);

  // If not an admin, redirect to org dashboard
  if (!role) {
    redirect(`/${locale}/dashboard`);
  }

  return <AdminLayoutWrapper role={role as AdminRole}>{children}</AdminLayoutWrapper>;
}
