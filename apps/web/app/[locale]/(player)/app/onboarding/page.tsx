import { getLocale, getTranslations } from 'next-intl/server';

import { OnboardingAccountBar } from './onboarding-account-bar';
import { PlayerOnboardingWizard } from './player-onboarding-wizard';

import { redirect } from '@/i18n/navigation';
import { CourtLines } from '@/components/court-lines';
import LocaleToggle from '@/components/locale-toggle';
import { ModeToggle } from '@/components/mode-toggle';
import ThemeLogo from '@/components/theme-logo';
import { getPlayerShellData } from '@/lib/supabase/check-player';
import { createClient } from '@/lib/supabase/server';

/**
 * Where the shell sends a signed-in player whose record is missing a name, a sport
 * or a location — most often someone who just created an account at /app/sign-in.
 *
 * The frame reuses the sign-in page's ambience (drift blobs, receding court) so the
 * sign-in → onboarding hop reads as one continuous journey, not two products.
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
    <div className="relative isolate min-h-screen overflow-x-clip">
      {/* Ambient glow blobs; tokens flip them per theme, motion honours reduced-motion */}
      <div
        aria-hidden="true"
        className="animate-hero-drift pointer-events-none absolute -left-32 -top-40 -z-10 size-96 rounded-full bg-[var(--primary-300)]/30 blur-3xl dark:bg-[var(--primary-500)]/10"
      />
      <div
        aria-hidden="true"
        className="animate-hero-drift-slow pointer-events-none absolute -right-32 top-1/4 -z-10 size-[26rem] rounded-full bg-[var(--secondary-300)]/25 blur-3xl dark:bg-[var(--secondary-500)]/10"
      />
      {/* The court floor stays fixed so it keeps receding under the scrolling wizard */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-[-10%] bottom-[-8%] -z-10 [perspective:900px]"
      >
        <CourtLines className="w-full text-[var(--primary-700)]/15 [mask-image:linear-gradient(to_top,black_20%,transparent_85%)] [transform:rotateX(52deg)] dark:text-[var(--primary-500)]/10" />
      </div>

      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <ThemeLogo width={104} height={31} href="/" />
        <div className="flex min-w-0 items-center gap-2">
          {user?.email && <OnboardingAccountBar email={user.email} />}
          <LocaleToggle />
          <ModeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
        <div className="mb-8 space-y-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('welcome')}
          </h1>
          <p className="text-muted-foreground">{t('welcomeSubtitle')}</p>
        </div>

        {user && (
          <PlayerOnboardingWizard
            userId={user.id}
            initialSportId={shellData?.primarySportId ?? null}
            initialProfilePictureUrl={shellData?.profilePictureUrl ?? null}
          />
        )}
      </main>
    </div>
  );
}
