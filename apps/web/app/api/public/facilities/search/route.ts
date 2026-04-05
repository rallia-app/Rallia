import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const sport = searchParams.get('sport');

    if (!query || query.length < 2) {
      return NextResponse.json({ facilities: [] });
    }

    const supabase = createServiceRoleClient();

    let dbQuery = supabase
      .from('facility')
      .select('id, name, city, address, facility_sport!inner(sport!inner(name))')
      .eq('is_active', true)
      .ilike('name', `%${query}%`)
      .limit(10);

    if (sport) {
      dbQuery = dbQuery.eq('facility_sport.sport.name', sport);
    }

    const { data, error } = await dbQuery;

    if (error) {
      console.error('Facility search error:', error);
      return NextResponse.json({ error: 'Failed to search facilities' }, { status: 500 });
    }

    const facilities = (data ?? []).map(
      (f: { id: string; name: string; city: string | null; address: string | null }) => ({
        id: f.id,
        name: f.name,
        city: f.city,
        address: f.address,
      })
    );

    return NextResponse.json({ facilities });
  } catch (error) {
    console.error('Facility search error:', error);
    return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
  }
}
