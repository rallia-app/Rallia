import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Locale } from '@rallia/shared-translations';

import FindAMatchClient from './FindAMatchClient';

import { buildPageMetadata } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const metadata = await buildPageMetadata({
    locale,
    path: '/find-a-match',
    namespace: 'seo.findAMatch',
    noindex: true,
  });
  // The flow runs under its own brand — escape the "| Rallia" title template.
  return {
    ...metadata,
    title: { absolute: typeof metadata.title === 'string' ? metadata.title : '' },
  };
}

/** FR for Québec and France, EN everywhere else. */
function preferredLocaleFromGeo(country?: string, region?: string): 'fr-CA' | 'en-US' {
  const c = country?.toUpperCase();
  const r = region?.toUpperCase();
  if (c === 'FR' || (c === 'CA' && r === 'QC')) return 'fr-CA';
  return 'en-US';
}

export default async function FindAMatchPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;

  // Default the language by geolocation on first visit, unless the visitor has
  // manually picked one (cookie set by the in-flow language switcher). Only acts
  // when Vercel geo headers are present, so local dev never forces a redirect.
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const manualChoice = cookieStore.get('smoke_lang')?.value;
  if (!manualChoice) {
    const country = headerList.get('x-vercel-ip-country') ?? undefined;
    if (country) {
      const region = headerList.get('x-vercel-ip-country-region') ?? undefined;
      const preferred = preferredLocaleFromGeo(country, region);
      if (preferred !== locale) {
        redirect(`/${preferred}/find-a-match`);
      }
    }
  }

  // Visitor's city from Vercel geo, so the address example matches where they
  // are and early funnel events carry a `ville`. Absent in local dev.
  const rawCity = headerList.get('x-vercel-ip-city') ?? undefined;
  const geoCity = rawCity ? decodeURIComponent(rawCity) : null;

  return <FindAMatchClient geoCity={geoCity} />;
}
