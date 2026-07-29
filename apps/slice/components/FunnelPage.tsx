import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import FindAMatchClient from '@/components/FindAMatchClient';
import enUS from '@/messages/en-US.json';
import frCA from '@/messages/fr-CA.json';

export type FunnelLocale = 'en-US' | 'fr-CA';

// Kept as full locale tags, not 'en'/'fr': useLocale() feeds Intl.NumberFormat
// and DateTimeFormat throughout the wizard, and fr vs fr-CA changes currency
// and weekday formatting.
const MESSAGES: Record<FunnelLocale, typeof enUS> = {
  'en-US': enUS,
  'fr-CA': frCA as typeof enUS,
};

const PATH_FOR: Record<FunnelLocale, string> = { 'en-US': '/', 'fr-CA': '/fr' };

export function buildFunnelMetadata(locale: FunnelLocale): Metadata {
  const seo = MESSAGES[locale].seo;
  return {
    title: seo.title,
    description: seo.description,
    robots: { index: false, follow: false },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      siteName: 'Slice',
      locale,
      type: 'website',
    },
  };
}

/** FR for Québec and France, EN everywhere else. */
function preferredLocaleFromGeo(country?: string, region?: string): FunnelLocale {
  const c = country?.toUpperCase();
  const r = region?.toUpperCase();
  if (c === 'FR' || (c === 'CA' && r === 'QC')) return 'fr-CA';
  return 'en-US';
}

export async function FunnelPage({ locale }: { locale: FunnelLocale }) {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);

  // Default the language by geolocation on first visit, unless the visitor has
  // manually picked one. Only acts when Vercel geo headers are present, so
  // local dev never forces a redirect.
  const manualChoice = cookieStore.get('slice_lang')?.value;
  if (!manualChoice) {
    const country = headerList.get('x-vercel-ip-country') ?? undefined;
    if (country) {
      const region = headerList.get('x-vercel-ip-country-region') ?? undefined;
      const preferred = preferredLocaleFromGeo(country, region);
      if (preferred !== locale) redirect(PATH_FOR[preferred]);
    }
  }

  const rawCity = headerList.get('x-vercel-ip-city') ?? undefined;
  const geoCity = rawCity ? decodeURIComponent(rawCity) : null;

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <FindAMatchClient geoCity={geoCity} />
    </NextIntlClientProvider>
  );
}
