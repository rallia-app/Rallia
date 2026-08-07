import { ArrowLeft, Building2, CalendarClock, Footprints, Lock, MapPin, Users } from 'lucide-react';
import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import type { FacilitySearchResult } from '@rallia/shared-types';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';

import { getRelativeDateLabel, formatDuration } from '../../_components/utils';

import FacilityBookingPanel from './facility-booking-panel';

import { Badge } from '@/components/ui/badge';
import { JsonLd } from '@/components/json-ld';
import { Link } from '@/i18n/navigation';
import { buildAlternates, SITE_URL } from '@/lib/seo';
import { createServiceRoleClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISR: ~700 facility pages enter the sitemap; the crawler wave must hit the
// cache, not a function invocation per page. Availability snapshots refresh
// on this cadence too.
export const revalidate = 300;

// No slugs at build time — each facility page is generated on first request
// and then served from the ISR cache (this is what opts the route into caching).
export function generateStaticParams() {
  return [];
}

interface FacilityRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_first_come_first_serve: boolean;
  membership_required: boolean;
  organization: { name: string; nature: string } | null;
}

/** Cards link by id; the canonical URL is the slug — id hits redirect.
 * cache() dedupes the generateMetadata + page render pair into one query. */
const getFacility = cache(async (slugOrId: string): Promise<FacilityRow | null> => {
  const supabase = createServiceRoleClient();
  let query = supabase
    .from('facility')
    .select(
      'id, name, slug, description, address, city, postal_code, latitude, longitude, timezone, is_first_come_first_serve, membership_required, organization:organization_id (name, nature)'
    )
    .eq('is_active', true)
    .is('archived_at', null);
  query = UUID_RE.test(slugOrId) ? query.eq('id', slugOrId) : query.eq('slug', slugOrId);
  const { data } = await query.maybeSingle();
  return data;
});

interface SportRow {
  id: string;
  name: string;
  slug: string;
}

/**
 * The nearby-search RPC is the only place booking capability, court counts and
 * availability snapshots get resolved (provider template + org fallbacks), so
 * reuse it: search a tiny radius around the facility and pick out its row.
 */
async function getEnrichedRow(
  facility: FacilityRow
): Promise<{ row: FacilitySearchResult | null; sports: SportRow[] }> {
  const supabase = createServiceRoleClient();
  const { data: sports } = await supabase
    .from('sport')
    .select('id, name, slug')
    .eq('is_active', true);
  const sportRows = (sports ?? []) as SportRow[];
  if (facility.latitude == null || facility.longitude == null || sportRows.length === 0) {
    return { row: null, sports: sportRows };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('search_facilities_nearby', {
    p_sport_ids: sportRows.map(s => s.id),
    p_latitude: facility.latitude,
    p_longitude: facility.longitude,
    p_max_distance_km: 1,
    p_limit: 50,
    p_offset: 0,
  });
  const row = ((data ?? []) as FacilitySearchResult[]).find(f => f.id === facility.id) ?? null;
  return { row, sports: sportRows };
}

interface FacilityMatch {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string | null;
  format: string;
  sport: { name: string } | null;
  participants: Array<{ id: string; status: string }> | null;
}

async function getUpcomingGames(facilityId: string): Promise<FacilityMatch[]> {
  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error } = await (supabase as any).rpc('search_public_matches', {
    p_latitude: 0,
    p_longitude: 0,
    p_max_distance_km: null,
    p_sport_id: null,
    p_limit: 8,
    p_offset: 0,
    p_facility_id: facilityId,
  });
  if (error || !rpcData?.length) return [];

  const ids = (rpcData as Array<{ match_id: string }>).map(r => r.match_id);
  const { data: matches } = await supabase
    .from('match')
    .select(
      'id, match_date, start_time, end_time, format, sport:sport_id (name), participants:match_participant (id, status)'
    )
    .in('id', ids);

  return ((matches ?? []) as unknown as FacilityMatch[]).sort((a, b) =>
    `${a.match_date}T${a.start_time}`.localeCompare(`${b.match_date}T${b.start_time}`)
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const facility = await getFacility(slug);
  if (!facility) return {};
  const t = await getTranslations({ locale, namespace: 'facilityPage' });
  const description = facility.city
    ? t('metaDescriptionCity', { name: facility.name, city: facility.city })
    : t('metaDescription', { name: facility.name });
  const title = facility.city ? `${facility.name} · ${facility.city}` : facility.name;

  return {
    title,
    description,
    alternates: buildAlternates(`/play/courts/${facility.slug}`, locale),
    openGraph: { title, description, type: 'website' },
  };
}

export default async function FacilityPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const facility = await getFacility(slug);
  if (!facility) notFound();
  // Canonicalize id-based links onto the slug URL.
  if (UUID_RE.test(slug) && facility.slug && facility.slug !== slug) {
    permanentRedirect(`/${locale}/play/courts/${facility.slug}`);
  }

  const [t, tCourts, tGames, { row, sports }, games] = await Promise.all([
    getTranslations({ locale, namespace: 'facilityPage' }),
    getTranslations({ locale, namespace: 'courtsPage' }),
    getTranslations({ locale, namespace: 'gamesPage' }),
    getEnrichedRow(facility),
    getUpcomingGames(facility.id),
  ]);

  const addressLine = [facility.address, facility.city, facility.postal_code]
    .filter(Boolean)
    .join(', ');
  const canBookOnline = !!row?.booking_url_template && !!row?.external_provider_id;
  const facilitySports = sports.filter(s => row?.sport_ids?.includes(s.id));
  const organizationNature = row?.organization_nature ?? facility.organization?.nature ?? null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: facility.name,
    ...(facility.description ? { description: facility.description } : {}),
    ...(facility.address || facility.city
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(facility.address ? { streetAddress: facility.address } : {}),
            ...(facility.city ? { addressLocality: facility.city } : {}),
            ...(facility.postal_code ? { postalCode: facility.postal_code } : {}),
          },
        }
      : {}),
    ...(facility.latitude != null && facility.longitude != null
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: facility.latitude,
            longitude: facility.longitude,
          },
        }
      : {}),
    url: `${SITE_URL}/${locale}/play/courts/${facility.slug}`,
  };

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <JsonLd data={[jsonLd]} />

      <Link
        href="/play?kind=courts"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('backToCourts')}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{facility.name}</h1>
        {addressLine && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <MapPin className="mt-1 size-4 shrink-0" />
            {addressLine}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {row?.court_count ? (
            <Badge variant="secondary" className="gap-1 font-medium">
              <Building2 className="size-3" />
              {row.court_count === 1
                ? tCourts('courtCountSingular')
                : tCourts('courtCount', { count: row.court_count })}
            </Badge>
          ) : null}
          {facilitySports.map(sport => (
            <Badge key={sport.id} variant="secondary" className="font-medium capitalize">
              {sport.name}
            </Badge>
          ))}
          {organizationNature === 'public' && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            >
              <Building2 className="size-3" />
              {tCourts('badgePublic')}
            </Badge>
          )}
          {organizationNature === 'private' && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400"
            >
              <Lock className="size-3" />
              {tCourts('badgePrivate')}
            </Badge>
          )}
          {facility.is_first_come_first_serve && (
            <Badge variant="outline" className="gap-1">
              <Footprints className="size-3" />
              {tCourts('badgeFirstCome')}
            </Badge>
          )}
          {canBookOnline && (
            <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
              <CalendarClock className="size-3" />
              {tCourts('badgeBookable')}
            </Badge>
          )}
          {facility.membership_required && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400"
            >
              <Lock className="size-3" />
              {tCourts('badgeMembership')}
            </Badge>
          )}
        </div>
        {facility.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{facility.description}</p>
        )}
      </div>

      {/* Availability + booking */}
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-bold">{t('availabilityHeading')}</h2>
        <FacilityBookingPanel
          facilityId={facility.id}
          canBookOnline={canBookOnline}
          isFirstComeFirstServe={facility.is_first_come_first_serve}
          timezone={facility.timezone}
          availabilitySlots={row?.availability_slots ?? []}
        />
      </section>

      {/* Upcoming public games at this facility */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t('upcomingGames')}</h2>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noUpcomingGames')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {games.map(game => {
              const total = game.format === 'doubles' ? 4 : 2;
              const joined = game.participants?.filter(p => p.status === 'joined').length ?? 0;
              const spotsLeft = Math.max(0, total - joined);
              const dateLabel = getRelativeDateLabel(
                game.match_date,
                locale,
                tGames('today'),
                tGames('tomorrow')
              );
              const time = new Date(`${game.match_date}T${game.start_time}`).toLocaleTimeString(
                locale,
                { timeStyle: 'short' }
              );
              const duration = game.end_time
                ? formatDuration(game.start_time, game.end_time)
                : null;
              return (
                <li key={game.id}>
                  <Link
                    href={`/join/match/${game.id}`}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="mb-0 text-sm font-semibold capitalize">
                        {dateLabel}
                        <span className="font-normal text-muted-foreground">
                          {' · '}
                          {time}
                          {duration && ` · ${duration}`}
                        </span>
                      </p>
                      <p className="mb-0 mt-0.5 text-xs capitalize text-muted-foreground">
                        {game.sport?.name}
                      </p>
                    </div>
                    <span
                      className={
                        spotsLeft === 0
                          ? 'flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive'
                          : 'flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      <Users className="size-3.5" />
                      {spotsLeft === 0
                        ? tGames('matchFull')
                        : tGames('spotsLeft', { count: spotsLeft })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
