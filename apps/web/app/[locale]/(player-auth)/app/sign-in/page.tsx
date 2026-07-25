import { CalendarCheck2, MapPin, UsersRound } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { CourtLines } from './court-lines';

import { Link, redirect } from '@/i18n/navigation';
import LocaleToggle from '@/components/locale-toggle';
import { ModeToggle } from '@/components/mode-toggle';
import ThemeLogo from '@/components/theme-logo';
import { OrganizationSignInForm } from '@/components/organization-sign-in-form';
import { createClient } from '@/lib/supabase/server';

/**
 * Only accepts same-origin app paths. `next` comes off the query string, so without
 * this an attacker could craft a sign-in link that bounces the player somewhere else
 * once they authenticate.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/app';
  const decoded = decodeURIComponent(next);
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/app';
  // Locale-prefixed paths arrive from the x-pathname header (/en-US/app/games).
  const withoutLocale = decoded.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/)/, '');
  return withoutLocale.startsWith('/app') ? withoutLocale : '/app';
}

/**
 * Player sign-in: a split hero on desktop, a compact brand header on mobile.
 *
 * Every string comes from the `auth` namespace mobile's sign-in wizard already uses
 * (welcome title, tagline, the three benefit bullets, the terms line), so the two
 * apps greet a player identically in both locales.
 */
export default async function PlayerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const destination = safeNext(params.next);
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect({ href: destination, locale });
  }

  const t = await getTranslations('auth');

  const benefits = [
    { icon: UsersRound, text: t('benefitFindPartners') },
    { icon: CalendarCheck2, text: t('benefitCreateGames') },
    { icon: MapPin, text: t('benefitJoinCommunity') },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Brand panel — desktop only */}
      <aside className="hero-gradient relative hidden w-[45%] max-w-2xl overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Court art sits behind the ::before contrast overlay's siblings, so lift content with z-10 */}
        <CourtLines className="pointer-events-none absolute -bottom-24 -right-40 w-[720px] -rotate-6 text-foreground/[0.07]" />

        <div className="relative z-10">
          <ThemeLogo width={120} height={36} href="/" />
        </div>

        <div className="relative z-10 space-y-10">
          <div className="space-y-3">
            <h2 className="font-heading text-4xl font-bold tracking-tight text-foreground xl:text-5xl">
              {t('welcomeTitle')}
            </h2>
            <p className="text-xl font-medium text-[var(--secondary-600)] dark:text-[var(--secondary-400)]">
              {t('welcomeSubtitle')}
            </p>
          </div>

          <ul className="space-y-5">
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-4">
                <span className="glass-morphism flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <Icon
                    className="size-5 text-[var(--primary-600)] dark:text-[var(--primary-400)]"
                    aria-hidden="true"
                  />
                </span>
                <span className="pt-2 text-sm leading-relaxed text-foreground/80">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Spacer keeps the middle block vertically centered against the logo row */}
        <div className="relative z-10 h-9" />
      </aside>

      {/* Form panel */}
      <main className="relative flex min-h-screen flex-1 items-center justify-center px-6 py-16">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <LocaleToggle />
          <ModeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Compact brand header — under lg the hero panel is gone */}
          <div className="mb-10 flex flex-col items-start gap-3 lg:hidden">
            <ThemeLogo width={104} height={31} href="/" />
            <p className="text-sm font-medium text-[var(--secondary-600)] dark:text-[var(--secondary-400)]">
              {t('welcomeSubtitle')}
            </p>
          </div>

          <OrganizationSignInForm
            variant="plain"
            initialError={params.error}
            successPath={destination}
            next={destination}
            title={t('welcomeBack')}
            description={t('createAccount')}
          />

          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t('termsPrefix')}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              {t('termsLink')}
            </Link>
            {t('termsMiddle')}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              {t('privacyLink')}
            </Link>
            {t('termsSuffix')}
          </p>
        </div>
      </main>
    </div>
  );
}
