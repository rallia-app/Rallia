import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 12;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Number(searchParams.get('limit')) || DEFAULT_LIMIT;
    const offset = Number(searchParams.get('offset')) || 0;
    const sportId = searchParams.get('sportId') || null;

    const supabase = createServiceRoleClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('get_public_communities', {
      p_player_id: null,
      p_sport_id: sportId,
      p_offset: offset,
      p_limit: limit + 1, // +1 to check hasMore
    });

    if (error) {
      console.error('RPC error:', error);
      return NextResponse.json({ error: 'Failed to fetch communities' }, { status: 500 });
    }

    const results = (data ?? []) as Array<Record<string, unknown>>;
    const hasMore = results.length > limit;
    const communities = hasMore ? results.slice(0, limit) : results;

    return NextResponse.json({ communities, hasMore });
  } catch (error) {
    console.error('Public communities fetch error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
