import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 24;

// Mirrors the public /games API shape: service-role RPC → hydrated rows. The
// facilities directory is a public marketing surface (no auth required to
// browse — sign-in only gates the in-app booking action), so we use the
// service-role client rather than the caller's session.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const latitude = searchParams.get('latitude') ? Number(searchParams.get('latitude')) : null;
    const longitude = searchParams.get('longitude') ? Number(searchParams.get('longitude')) : null;
    const limit = Number(searchParams.get('limit')) || DEFAULT_LIMIT;
    const offset = Number(searchParams.get('offset')) || 0;
    const sportId = searchParams.get('sportId') || null;
    const query = searchParams.get('query')?.trim() || null;
    const maxKmParam = Number(searchParams.get('maxKm'));
    const maxKm = Number.isFinite(maxKmParam) && maxKmParam > 0 ? maxKmParam : null;

    const supabase = createServiceRoleClient();

    // search_facilities_nearby filters on p_sport_ids (a UUID[]). A single
    // selected sport → that id; "all sports" → every active sport id.
    let sportIds: string[];
    if (sportId) {
      sportIds = [sportId];
    } else {
      const { data: sports } = await supabase.from('sport').select('id').eq('is_active', true);
      sportIds = (sports ?? []).map(s => s.id);
    }
    if (sportIds.length === 0) {
      return NextResponse.json({ facilities: [], hasMore: false });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('search_facilities_nearby', {
      p_sport_ids: sportIds,
      p_latitude: latitude ?? 0,
      p_longitude: longitude ?? 0,
      p_search_query: query,
      p_max_distance_km: latitude != null && longitude != null ? maxKm : null,
      p_limit: limit + 1, // +1 to detect hasMore
      p_offset: offset,
      // Show every facility for the sport (parks included) — the same default
      // as the mobile directory. Availability chips appear on the cards that
      // have open slots; parks stay listed as first-come.
    });

    if (error) {
      console.error('Facility search RPC error:', error);
      return NextResponse.json({ error: 'Failed to fetch facilities' }, { status: 500 });
    }

    const rows = (data ?? []) as Array<{ distance_meters: number | null }>;
    const hasMore = rows.length > limit;
    let facilities = hasMore ? rows.slice(0, limit) : rows;

    // Without a real origin the RPC still returns a distance (measured from
    // 0,0), which would render as a nonsensical "8000 km away". Drop it so the
    // card simply omits distance until the client re-fetches with the
    // visitor's coordinates.
    if (latitude == null || longitude == null) {
      facilities = facilities.map(f => ({ ...f, distance_meters: null }));
    }

    return NextResponse.json({ facilities, hasMore });
  } catch (error) {
    console.error('Facility search error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
