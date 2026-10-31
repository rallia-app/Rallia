import CancelOrgOnboardingButton from '@/components/cancel-org-onboarding-button';
import { OrganizationOnboardingForm } from '@/components/organization-onboarding-form';
import { hasOrganizationMembership } from '@/lib/supabase/check-organization';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Create Your Organization - Rallia',
    description:
      'Create your organization profile to get started with Rallia. Join clubs, municipalities, cities, and associations.',
  };
}

export default async function OnboardingPage() {
  const t = await getTranslations('onboarding');
  const supabase = await createClient();

  // Get authenticated user (auth check is done in layout)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // If user already has an organization, redirect to dashboard
  const hasOrg = await hasOrganizationMembership(user.id);
  if (hasOrg) {
    redirect('/dashboard');
  }

  return (
    <div className="flex flex-col w-full gap-8 items-center">
      <div>
        <h1 className="text-3xl font-bold text-center">{t('pageTitle')}</h1>
        <p className="text-muted-foreground mt-2 text-center">{t('pageDescription')}</p>
        <div className="flex justify-center">
          <CancelOrgOnboardingButton label={t('cancel')} />
        </div>
      </div>

      <OrganizationOnboardingForm />
    </div>
  );
}
