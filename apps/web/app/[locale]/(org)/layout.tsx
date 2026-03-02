import { OrgLayoutWrapper } from '@/components/org-layout-wrapper';
import { hasOrganizationMembership } from '@/lib/supabase/check-organization';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';

  // Check if user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // If not authenticated, redirect to sign-in
  if (authError || !user) {
    redirect('/sign-in');
  }

  // Check if user has organization membership
  const hasOrg = await hasOrganizationMembership(user.id);
  const isOnboardingPage = pathname.includes('/onboarding');

  // For pages other than onboarding, require organization membership
  if (!hasOrg && !isOnboardingPage) {
    redirect('/onboarding');
  }

  return (
    <OrgLayoutWrapper hasOrg={hasOrg} userId={user.id} userEmail={user.email ?? ''}>
      {children}
    </OrgLayoutWrapper>
  );
}
