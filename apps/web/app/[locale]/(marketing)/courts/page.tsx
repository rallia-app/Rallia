import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { getTranslations } from 'next-intl/server';

import CourtsList from './_components/courts-list';

import { JsonLd } from '@/components/json-ld';
import { buildPageMetadata, SITE_URL } from '@/lib/seo';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/courts', namespace: 'seo.courts' });
}

const PAGE_SIZE = 24;

async function getInitialFacilities(): Promise<FacilitySearchResult[]> {
  const supabase = createServiceRoleClient();

  const { data: sports } = await supabase.from('sport').select('id').eq('is_active', true);
  const sportIds = (sports ?? []).map(s => s.id);
  if (sportIds.length === 0) return [];

  // Distance ordering from (0,0) is arbitrary for the SSR paint — the client
  // immediately re-fetches sorted by the visitor's real location. This just
  // gives crawlers and the first paint a populated list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('search_facilities_nearby', {
    p_sport_ids: sportIds,
    p_latitude: 0,
    p_longitude: 0,
    p_limit: PAGE_SIZE,
    p_offset: 0,
  });

  if (error || !data) return [];
  // The SSR origin is a placeholder (0,0), so the RPC's distance is meaningless
  // here — strip it and let the client fill in real distances after it resolves
  // the visitor's location.
  return (data as FacilitySearchResult[]).map(f => ({ ...f, distance_meters: null }));
}

function facilitiesToJsonLd(facilities: FacilitySearchResult[]) {
  return facilities.slice(0, 20).map(f => ({
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: f.name,
    ...(f.address || f.city
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(f.address ? { streetAddress: f.address } : {}),
            ...(f.city ? { addressLocality: f.city } : {}),
          },
        }
      : {}),
    ...(f.latitude != null && f.longitude != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: f.latitude, longitude: f.longitude } }
      : {}),
    url: `${SITE_URL}/en-US/courts`,
  }));
}

export default async function CourtsPage() {
  const t = await getTranslations('courtsPage');
  const facilities = await getInitialFacilities();
  const jsonLd = facilitiesToJsonLd(facilities);

  return (
    <div className="relative flex w-full flex-col gap-8">
      {jsonLd.length > 0 && <JsonLd data={jsonLd} />}

      {/* Soft decorative glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-64 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15"
      />

      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-background/60 px-3.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-teal-500" />
            Tennis
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Pickleball
          </span>
        </span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
        <p className="max-w-xl text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>

      <CourtsList initialFacilities={facilities} />
    </div>
  );
}
