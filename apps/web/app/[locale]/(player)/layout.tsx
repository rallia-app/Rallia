import { headers } from 'next/headers';
import type { Metadata } from 'next';

// next-intl's redirect, not next/navigation's: a locale-less path would be re-prefixed
// with the default locale by the intl middleware, silently dropping a fr-CA visitor
// into the English app.
import { redirect } from '@/i18n/navigation';

/**
 * next-intl's redirect throws (it wraps next/navigation's) but is typed as returning
 * void, so TypeScript will not narrow after it. Wrapping it in a `never` helper gives
 * the narrowing without the `return null` this guard used to end with — that null was
 * a real hazard, since anything that stopped the redirect throwing would render an
 * empty layout, i.e. a blank page, rather than failing loudly.
 */
function redirectNever(href: string, locale: string): never {
  redirect({ href, locale });
  throw new Error(`redirect(${href}) did not throw`);
}
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
    redirectNever(`/app/sign-in?next=${next}`, locale);
  }

  const shellData = await getPlayerShellData(user.id);

  // The onboarding route itself must stay reachable or the redirect loops.
  const isOnboardingPage = pathname.includes('/app/onboarding');
  if (!shellData.isOnboardingComplete && !isOnboardingPage) {
    redirectNever('/app/onboarding', locale);
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
