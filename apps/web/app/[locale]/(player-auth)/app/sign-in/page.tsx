import { getLocale, getTranslations } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
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

  // Reuses the `auth` namespace mobile's sign-in wizard uses, so a player sees the
  // same welcome in both apps and in both locales.
  const t = await getTranslations('auth');

  return (
    <OrganizationSignInForm
      initialError={params.error}
      successPath={destination}
      next={destination}
      title={t('welcomeBack')}
      description={t('createAccount')}
    />
  );
}
