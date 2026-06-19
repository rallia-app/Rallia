import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const sportId = request.nextUrl.searchParams.get('sportId');
    if (!sportId) {
      return NextResponse.json({ error: 'sportId is required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: sport, error: sportError } = await supabase
      .from('sport')
      .select('slug')
      .eq('id', sportId)
      .single();

    if (sportError || !sport) {
      return NextResponse.json({ error: 'Sport not found' }, { status: 404 });
    }

    const systemCode = sport.slug === 'pickleball' ? 'dupr' : 'ntrp';

    const { data: scores, error: scoresError } = await supabase
      .from('rating_score')
      .select('id, label, value, rating_system!inner(code, sport_id)')
      .eq('rating_system.sport_id', sportId)
      .eq('rating_system.code', systemCode)
      .order('value');

    if (scoresError) {
      console.error('[web-join/ratings]', scoresError);
      return NextResponse.json({ error: 'Failed to fetch ratings' }, { status: 500 });
    }

    return NextResponse.json({
      systemCode,
      ratings: (scores ?? []).map(s => ({
        id: s.id,
        label: s.label,
        value: s.value,
      })),
    });
  } catch (error) {
    console.error('[web-join/ratings]', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
