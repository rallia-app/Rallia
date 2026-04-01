import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.matchId || !body.email) {
      return NextResponse.json({ error: 'Match ID and email are required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types until migration runs
    const { data, error } = await (supabase as any)
      .from('match_interest')
      .insert({
        match_id: body.matchId,
        email: body.email,
        name: body.name || null,
        locale: body.locale || 'en-US',
        ip_address: body.ipAddress || null,
        location: body.location || null,
      })
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to submit interest' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error('Match interest submission error:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}
