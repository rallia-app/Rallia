import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport');
    const system = searchParams.get('system');

    if (!sport || !system) {
      return NextResponse.json(
        { error: 'sport and system query parameters are required' },
        { status: 400 }
      );
    }

    const validCombinations: Record<string, 'ntrp' | 'dupr'> = {
      tennis: 'ntrp',
      pickleball: 'dupr',
    };

    const expectedSystem = validCombinations[sport];
    if (!expectedSystem || expectedSystem !== system) {
      return NextResponse.json({ error: 'Invalid sport/system combination' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('get_rating_scores_by_type', {
      p_sport_name: sport,
      p_rating_system_code: expectedSystem,
    });

    if (error) {
      console.error('Rating scores RPC error:', error);
      return NextResponse.json({ error: 'Failed to fetch rating scores' }, { status: 500 });
    }

    return NextResponse.json({ ratings: data ?? [] });
  } catch (error) {
    console.error('Rating scores error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
