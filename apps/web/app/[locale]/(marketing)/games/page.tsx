import type { Metadata } from 'next';
import type { Locale } from '@rallia/shared-translations';
import { getTranslations } from 'next-intl/server';

import GamesMatchList from './_components/games-match-list';
import type { PublicMatch } from './_components/public-match-card';

import { JsonLd, sportsEventJsonLd } from '@/components/json-ld';
import { buildPageMetadata, SITE_URL } from '@/lib/seo';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildPageMetadata({ locale, path: '/games', namespace: 'seo.games' });
}

const PAGE_SIZE = 12;

async function getInitialMatches(): Promise<PublicMatch[]> {
  const supabase = createServiceRoleClient();

  // Step 1: Call RPC to get match IDs (handles timezone-aware filtering, excludes full/past matches)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc('search_public_matches', {
    p_latitude: 0,
    p_longitude: 0,
    p_max_distance_km: null,
    p_sport_id: null,
    p_limit: PAGE_SIZE,
    p_offset: 0,
  });

  if (rpcError || !rpcData?.length) return [];

  const matchIds = (rpcData as Array<{ match_id: string }>).map(r => r.match_id);

  // Step 2: Hydrate full match details
  const { data: matches } = await supabase
    .from('match')
    .select(
      `*, sport:sport_id (name, slug), facility:facility_id (name, city, latitude, longitude), court:court_id (name), participants:match_participant (id, status, is_host, player_id, player:player_id (profile (display_name, profile_picture_url))), min_rating_score:min_rating_score_id (label)`
    )
    .in('id', matchIds);

  // Preserve RPC ordering
  const matchMap = new Map((matches ?? []).map(m => [m.id, m]));
  return matchIds
    .filter(id => matchMap.has(id))
    .map(id => matchMap.get(id)!) as unknown as PublicMatch[];
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

export default async function GamesPage() {
  const t = await getTranslations('gamesPage');
  const matches = await getInitialMatches();
  const events = matchesToSportsEvents(matches);

  return (
    <div className="flex flex-col w-full gap-8">
      {events.length > 0 && <JsonLd data={events} />}
      <div className="text-center">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>
      <GamesMatchList initialMatches={matches} />
    </div>
  );
}
