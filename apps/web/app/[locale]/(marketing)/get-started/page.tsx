import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { GetStartedHandoff } from './get-started-handoff';
import { GetStartedWizard, type GetStartedAttribution } from './get-started-wizard';

import { SharedSupabaseSync } from '@/components/shared-supabase-sync';
import { getLandingContext } from '@/lib/landing-attribution';
import { SITE_URL } from '@/lib/seo';
import { createClient } from '@/lib/supabase/server';
import { signInProviderOf } from '@/lib/web-onboarding/sign-in-provider';

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webOnboarding.funnel' });
  return {
    title: t('pageTitle'),
    description: t('pageDescription'),
    robots: { index: false, follow: false },
  };
}

function firstString(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The query string worth carrying through the OAuth round trip: attribution only. */
function buildReturnQuery(query: SearchParams): string {
  const params = new URLSearchParams();
  for (const key of [
    'ref',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
  ]) {
    const value = firstString(query[key]);
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * The standalone web onboarding funnel: create an app-valid account on the web, then
 * install. Public, noindex, independent of the parked player shell. A signed-in player
 * who is already onboarded skips straight to the hand-off.
 */
export default async function GetStartedPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const { platform, utm } = await getLandingContext(query);

  const referralCode = firstString(query.ref)?.toUpperCase();
  const attribution: GetStartedAttribution = {
    ...(utm
      ? {
          utm: {
            ...(utm.utm_source ? { source: utm.utm_source } : {}),
            ...(utm.utm_medium ? { medium: utm.utm_medium } : {}),
            ...(utm.utm_campaign ? { campaign: utm.utm_campaign } : {}),
            ...(utm.utm_term ? { term: utm.utm_term } : {}),
            ...(utm.utm_content ? { content: utm.utm_content } : {}),
          },
        }
      : {}),
    ...(referralCode ? { referralCode } : {}),
  };

  // The /api/go bouncer opens the app when it is installed and falls back to the store,
  // which is exactly what a phone scanning the desktop hand-off needs.
  const installUrl = `${SITE_URL}/api/go?to=home&locale=${locale}&src=web_onboarding`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let alreadyOnboarded = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profile')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();
    alreadyOnboarded = profile?.onboarding_completed === true;
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in px-0 py-4 sm:px-4 lg:py-8">
      {user && alreadyOnboarded ? (
        <GetStartedHandoff
          provider={signInProviderOf(user)}
          email={user.email ?? null}
          platform={platform}
          installUrl={installUrl}
          referralCode={referralCode}
        />
      ) : (
        <>
          {/* Shared hooks (sports, facilities) read the shared singleton; wire it before they mount. */}
          <SharedSupabaseSync />
          <GetStartedWizard
            locale={locale}
            platform={platform}
            attribution={attribution}
            returnQuery={buildReturnQuery(query)}
            installUrl={installUrl}
          />
        </>
      )}
    </div>
  );
}
