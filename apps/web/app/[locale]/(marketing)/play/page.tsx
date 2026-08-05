import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';

import PlayExplorer, {
  SEARCH_RADIUS_KM,
  type PlayInitialParams,
  type PlayKind,
  type ViewMode,
} from './_components/play-explorer';
import type { PublicMatch } from './_components/public-match-card';
import type { DateChip } from './_components/utils';

import { JsonLd, sportsEventJsonLd } from '@/components/json-ld';
import { buildPageMetadata, SITE_URL } from '@/lib/seo';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/play', namespace: 'seo.play' });
}

// Larger initial page so several days of matches load up front (each date renders its own carousel row)
const MATCH_PAGE_SIZE = 36;
const FACILITY_PAGE_SIZE = 24;

interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * Approximate visitor location from the request's geo headers (Vercel injects
 * them at the edge). Null on localhost or when the platform can't resolve one
 * — the client then falls back to an IP lookup.
 */
async function getRequestCoords(): Promise<Coords | null> {
  const h = await headers();
  const latitude = Number(h.get('x-vercel-ip-latitude'));
  const longitude = Number(h.get('x-vercel-ip-longitude'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

async function getInitialMatches(coords: Coords | null): Promise<PublicMatch[]> {
  const supabase = createServiceRoleClient();

  // Step 1: Call RPC to get match IDs (handles timezone-aware filtering, excludes full/past matches)
  const searchMatches = async (maxKm: number | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('search_public_matches', {
      p_latitude: coords?.latitude ?? 0,
      p_longitude: coords?.longitude ?? 0,
      p_max_distance_km: coords ? maxKm : null,
      p_sport_id: null,
      p_limit: MATCH_PAGE_SIZE,
      p_offset: 0,
    });
    if (error || !data) return [];
    return data as Array<{ match_id: string }>;
  };

  let rpcData = await searchMatches(coords ? SEARCH_RADIUS_KM : null);
  if (coords && rpcData.length === 0) rpcData = await searchMatches(null);
  if (rpcData.length === 0) return [];

  const matchIds = rpcData.map(r => r.match_id);

  // Step 2: Hydrate full match details
  const { data: matches } = await supabase
    .from('match')
    .select(
      `*, sport:sport_id (name, slug), facility:facility_id (name, city, latitude, longitude), court:court_id (name), participants:match_participant (id, status, is_host, player_id, player:player_id (profile!player_id_fkey (display_name, profile_picture_url))), min_rating_score:min_rating_score_id (label)`
    )
    .in('id', matchIds);

  // Preserve RPC ordering
  const matchMap = new Map((matches ?? []).map(m => [m.id, m]));
  return matchIds
    .filter(id => matchMap.has(id))
    .map(id => matchMap.get(id)!) as unknown as PublicMatch[];
}

async function getInitialFacilities(
  coords: Coords | null,
  bookableOnly: boolean
): Promise<FacilitySearchResult[]> {
  const supabase = createServiceRoleClient();

  const { data: sports } = await supabase.from('sport').select('id').eq('is_active', true);
  const sportIds = (sports ?? []).map(s => s.id);
  if (sportIds.length === 0) return [];

  const searchFacilities = async (maxKm: number | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('search_facilities_nearby', {
      p_sport_ids: sportIds,
      p_latitude: coords?.latitude ?? 0,
      p_longitude: coords?.longitude ?? 0,
      p_max_distance_km: coords ? maxKm : null,
      p_has_availabilities: bookableOnly ? true : null,
      p_limit: FACILITY_PAGE_SIZE,
      p_offset: 0,
    });
    if (error || !data) return [];
    return data as FacilitySearchResult[];
  };

  let rows = await searchFacilities(coords ? SEARCH_RADIUS_KM : null);
  if (coords && rows.length === 0) rows = await searchFacilities(null);

  // Without a real origin the RPC's distance is measured from (0,0) and
  // meaningless — strip it and let the client fill in real distances once it
  // resolves the visitor's location.
  return coords ? rows : rows.map(f => ({ ...f, distance_meters: null }));
}

function matchesToSportsEvents(matches: PublicMatch[]) {
  return matches.slice(0, 20).map(m => {
    const sportName = m.sport?.name ?? 'racquet sport';
    const capitalized = sportName.charAt(0).toUpperCase() + sportName.slice(1);
    const location = m.facility?.name ?? m.location_name ?? 'TBD';

    return sportsEventJsonLd({
      name: `${capitalized} ${m.format === 'doubles' ? 'Doubles' : 'Singles'} Game`,
      sportName: capitalized,
      startDate: `${m.match_date}T${m.start_time}`,
      ...(m.end_time && { endDate: `${m.match_date}T${m.end_time}` }),
      locationName: location,
      locationCity: m.facility?.city,
      latitude: m.facility?.latitude,
      longitude: m.facility?.longitude,
      url: `${SITE_URL}/en-US/match/${m.id}`,
    });
  });
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
    url: `${SITE_URL}/en-US/play/courts/${f.id}`,
  }));
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseInitialParams(sp: Record<string, string | string[] | undefined>): PlayInitialParams {
  const kindParam = first(sp.kind);
  const viewParam = first(sp.view);
  const dateParam = first(sp.date);
  const view: ViewMode = viewParam === 'map' ? 'map' : 'list';
  // Lists are single-kind; "all" is only valid on the map.
  const kind: PlayKind =
    kindParam === 'games' || kindParam === 'courts' ? kindParam : view === 'map' ? 'all' : 'games';
  const date: DateChip =
    dateParam === 'today' || dateParam === 'tomorrow' || dateParam === 'weekend'
      ? dateParam
      : 'all';
  return {
    kind,
    view,
    sportSlug: first(sp.sport) || null,
    date,
    mine: first(sp.mine) === '1',
    openOnly: first(sp.open) === '1',
    bookableOnly: first(sp.bookable) === '1',
    query: kind === 'courts' ? (first(sp.q) ?? '') : '',
  };
}

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('playPage');
  const [sp, coords] = await Promise.all([searchParams, getRequestCoords()]);
  const initialParams = parseInitialParams(sp);
  const [matches, facilities] = await Promise.all([
    getInitialMatches(coords),
    getInitialFacilities(coords, initialParams.bookableOnly),
  ]);
  const jsonLd = [...matchesToSportsEvents(matches), ...facilitiesToJsonLd(facilities)];

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

      <PlayExplorer
        initialMatches={matches}
        initialFacilities={facilities}
        initialCoords={coords}
        initialParams={initialParams}
      />
    </div>
  );
}
