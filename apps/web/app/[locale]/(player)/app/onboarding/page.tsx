import { getLocale, getTranslations } from 'next-intl/server';

import { OnboardingAccountBar } from './onboarding-account-bar';
import { PlayerOnboardingWizard } from './player-onboarding-wizard';

import { redirect } from '@/i18n/navigation';
import { getPlayerShellData } from '@/lib/supabase/check-player';
import { createClient } from '@/lib/supabase/server';

/**
 * Where the shell sends a signed-in player whose record is missing a name, a sport
 * or a location — most often someone who just created an account at /app/sign-in.
 */
export default async function PlayerOnboardingPage() {
  const locale = await getLocale();
  const t = await getTranslations('onboarding');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The layout guard already ran; this catches a direct hit after the record was
  // completed elsewhere (most likely in the app), so nobody is shown a wizard for
  // work they have already done.
  const shellData = user ? await getPlayerShellData(user.id) : null;
  if (shellData?.isOnboardingComplete) {
    redirect({ href: '/app', locale });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-foreground">{t('welcome')}</h1>
        <p className="text-muted-foreground">{t('welcomeSubtitle')}</p>
      </div>

      {user?.email && <OnboardingAccountBar email={user.email} />}

      <PlayerOnboardingWizard initialSportId={shellData?.primarySportId ?? null} />
    </div>
  );
}
