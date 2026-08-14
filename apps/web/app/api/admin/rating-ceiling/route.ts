import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Clears a player's prize-draw rating ceiling for one sport.
 *
 * Deliberately NOT the service-role client: admin_clear_rating_ceiling gates on
 * is_admin() and stamps admin_cleared_by from auth.uid(), so calling it as the
 * service role would both fail the gate and lose the audit trail. The signed-in
 * admin's session is the credential.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowed } = await requireApiRole(user.id, ['super_admin', 'moderator']);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { playerId, sportId, reason } = await request.json();

    if (!playerId || !sportId) {
      return NextResponse.json({ error: 'Missing playerId or sportId' }, { status: 400 });
    }
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('admin_clear_rating_ceiling', {
      p_player_id: playerId,
      p_sport_id: sportId,
      p_reason: reason.trim(),
    });

    if (error) {
      // NOT_ADMIN / REASON_REQUIRED / NO_ACTIVE_RATING travel as the message.
      const known = ['NOT_ADMIN', 'REASON_REQUIRED', 'NO_ACTIVE_RATING'];
      const code = known.find(c => error.message?.includes(c));
      return NextResponse.json(
        { error: code ?? 'Failed to clear rating ceiling' },
        { status: code === 'NOT_ADMIN' ? 403 : 400 }
      );
    }

    return NextResponse.json({ cleared: data ?? 0 });
  } catch (error) {
    console.error('Clear rating ceiling error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
