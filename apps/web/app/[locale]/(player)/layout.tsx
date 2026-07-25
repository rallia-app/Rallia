import { headers } from 'next/headers';
import type { Metadata } from 'next';

// next-intl's redirect, not next/navigation's: a locale-less path would be re-prefixed
// with the default locale by the intl middleware, silently dropping a fr-CA visitor
// into the English app.
import { redirect } from '@/i18n/navigation';
import { PlayerShell } from '@/components/app/layout/player-shell';
import { getPlayerShellData } from '@/lib/supabase/check-player';
import { createClient } from '@/lib/supabase/server';
import { readSportCookie } from '@/lib/app/sport-cookie';

/**
 * The player app is private. robots.txt disallows the app path prefix, but that only
 * asks crawlers not to fetch — it does not stop a linked URL being indexed.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PlayerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';

  // getUser() and not getClaims(): this is an authorization boundary, so the token
  // gets verified. The proxy already did the cheap refresh on the way in.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    const next = encodeURIComponent(pathname || `/${locale}/app`);
    redirect({ href: `/app/sign-in?next=${next}`, locale });
    // redirect() throws, but next-intl types it as void, so narrow explicitly.
    return null;
  }

  const shellData = await getPlayerShellData(user.id);

  // The onboarding route itself must stay reachable or the redirect loops.
  const isOnboardingPage = pathname.includes('/app/onboarding');
  if (!shellData.isOnboardingComplete && !isOnboardingPage) {
    redirect({ href: '/app/onboarding', locale });
  }

  return (
    <PlayerShell
      userId={user.id}
      userEmail={user.email ?? ''}
      shellData={shellData}
      initialSportId={readSportCookie(await headers())}
      chromeless={isOnboardingPage}
    >
      {children}
    </PlayerShell>
  );
}
