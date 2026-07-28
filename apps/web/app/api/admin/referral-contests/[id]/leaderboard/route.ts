import { AdminCheckError, requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowed } = await requireApiRole(user.id, ['super_admin']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '20');

    const adminDb = createServiceRoleClient();
    const { data, error } = await adminDb.rpc('get_referral_leaderboard', {
      p_contest_id: id,
      p_limit: limit,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    if (error instanceof AdminCheckError) {
      return NextResponse.json({ error: 'Admin check unavailable' }, { status: 503 });
    }
    console.error('[Admin Referral Leaderboard GET]', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
