import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 12;

const MATCH_SELECT = `*, sport:sport_id (name, slug), facility:facility_id (name, city, latitude, longitude), court:court_id (name), participants:match_participant (id, status, is_host, player_id, player:player_id (profile (display_name, profile_picture_url))), min_rating_score:min_rating_score_id (label)`;

// Participation statuses that count as one of "my games" (mirrors getViewerMatchStatus)
const MINE_STATUSES = ['joined', 'requested', 'waitlisted', 'pending'] as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const latitude = searchParams.get('latitude') ? Number(searchParams.get('latitude')) : null;
    const longitude = searchParams.get('longitude') ? Number(searchParams.get('longitude')) : null;
    const limit = Number(searchParams.get('limit')) || DEFAULT_LIMIT;
    const offset = Number(searchParams.get('offset')) || 0;
    const sportId = searchParams.get('sportId') || null;
    const mine = searchParams.get('mine') === '1';

    if (mine) {
      return getMyMatches({ limit, offset, sportId });
    }

    const supabase = createServiceRoleClient();

    // Step 1: Call the RPC to get match IDs + distances (timezone-aware, filters out past/full matches)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
      'search_public_matches',
      {
        p_latitude: latitude ?? 0,
        p_longitude: longitude ?? 0,
        p_max_distance_km: null,
        p_sport_id: sportId,
        p_limit: limit + 1, // +1 to check hasMore
        p_offset: offset,
      }
    );

    if (rpcError) {
      console.error('RPC error:', rpcError);
      return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
    }

    const rpcResults = (rpcData ?? []) as Array<{
      match_id: string;
      distance_meters: number | null;
    }>;
    const hasMore = rpcResults.length > limit;
    const page = hasMore ? rpcResults.slice(0, limit) : rpcResults;

    if (page.length === 0) {
      return NextResponse.json({ matches: [], hasMore: false });
    }

    // Step 2: Hydrate full match details for the returned IDs
    const matchIds = page.map(r => r.match_id);
    const { data: matches, error: matchError } = await supabase
      .from('match')
      .select(MATCH_SELECT)
      .in('id', matchIds);

    if (matchError) {
      console.error('Match hydration error:', matchError);
      return NextResponse.json({ error: 'Failed to fetch match details' }, { status: 500 });
    }

    // Preserve RPC ordering and attach distance
    const matchMap = new Map((matches ?? []).map(m => [m.id, m]));
    const ordered = page
      .filter(r => matchMap.has(r.match_id))
      .map(r => ({
        ...matchMap.get(r.match_id)!,
        distance: r.distance_meters != null ? r.distance_meters / 1000 : null,
      }));

    return NextResponse.json({ matches: ordered, hasMore });
  } catch (error) {
    console.error('Public matches fetch error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}

/**
 * Returns the signed-in viewer's upcoming games (matches where they hold an
 * active participant record). Auth is derived from the session cookie, never
 * a client-supplied id. Returns an empty list when signed out.
 */
async function getMyMatches({
  limit,
  offset,
  sportId,
}: {
  limit: number;
  offset: number;
  sportId: string | null;
}) {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();

  if (!user) {
    return NextResponse.json({ matches: [], hasMore: false });
  }

  const supabase = createServiceRoleClient();

  const { data: parts, error: partsError } = await supabase
    .from('match_participant')
    .select('match_id')
    .eq('player_id', user.id)
    .in('status', MINE_STATUSES);

  if (partsError) {
    console.error('My matches participant lookup error:', partsError);
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
  }

  const matchIds = [...new Set((parts ?? []).map(p => p.match_id))];
  if (matchIds.length === 0) {
    return NextResponse.json({ matches: [], hasMore: false });
  }

  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from('match')
    .select(MATCH_SELECT)
    .in('id', matchIds)
    .is('cancelled_at', null)
    .gte('match_date', today)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .range(offset, offset + limit); // +1 row to check hasMore

  if (sportId) {
    query = query.eq('sport_id', sportId);
  }

  const { data: matches, error: matchError } = await query;

  if (matchError) {
    console.error('My matches hydration error:', matchError);
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
  }

  const rows = matches ?? [];
  const hasMore = rows.length > limit;
  return NextResponse.json({ matches: hasMore ? rows.slice(0, limit) : rows, hasMore });
}
