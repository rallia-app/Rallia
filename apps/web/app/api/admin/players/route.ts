import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['suspend', 'reactivate'] as const;
type PlayerAction = (typeof VALID_ACTIONS)[number];

type AccountStatus = 'active' | 'suspended' | 'deleted' | 'pending_verification';

const ACTION_STATUS_MAP: Record<PlayerAction, AccountStatus> = {
  suspend: 'suspended',
  reactivate: 'active',
};

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { playerIds, action } = await request.json();

    if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
      return NextResponse.json({ error: 'Missing player IDs' }, { status: 400 });
    }

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const newStatus = ACTION_STATUS_MAP[action as PlayerAction];
    const adminDb = createServiceRoleClient();

    const { error } = await adminDb
      .from('profile')
      .update({ account_status: newStatus })
      .in('id', playerIds);

    if (error) {
      console.error(`Error ${action} players:`, error);
      return NextResponse.json({ error: `Failed to ${action} players` }, { status: 500 });
    }

    // Audit log
    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'update',
      p_entity_type: 'player',
      p_entity_id: playerIds[0],
      p_entity_name: null,
      p_old_data: null,
      p_new_data: { account_status: newStatus },
      p_metadata: { action, player_ids: playerIds, count: playerIds.length },
      p_severity: action === 'suspend' ? 'warning' : 'info',
    });

    return NextResponse.json({
      success: true,
      updatedCount: playerIds.length,
    });
  } catch (error) {
    console.error('Admin players PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
