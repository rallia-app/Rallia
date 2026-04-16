import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['suspend', 'reactivate'] as const;
type PlayerAction = (typeof VALID_ACTIONS)[number];

type AccountStatus = 'active' | 'suspended' | 'deleted' | 'pending_verification';

const ACTION_STATUS_MAP: Record<PlayerAction, AccountStatus> = {
  suspend: 'suspended',
  reactivate: 'active',
};

const DEMO_ACCOUNT_EMAIL = 'demo@rallia.ca';

const USER_STORAGE_BUCKETS = [
  'profile-pictures',
  'rating-proof-images',
  'rating-proof-documents',
  'rating-proof-videos',
  'feedback-screenshots',
  'report-evidence',
];

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

    const { allowed } = await requireApiRole(user.id, ['super_admin', 'moderator']);
    if (!allowed) {
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

export async function DELETE(request: NextRequest) {
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

    const { playerIds } = await request.json();

    if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
      return NextResponse.json({ error: 'Missing player IDs' }, { status: 400 });
    }

    const adminDb = createServiceRoleClient();

    // Guard: check for demo account
    const { data: profiles } = await adminDb
      .from('profile')
      .select('id, email')
      .in('id', playerIds);

    const demoPlayer = profiles?.find(p => p.email === DEMO_ACCOUNT_EMAIL);
    if (demoPlayer) {
      return NextResponse.json({ error: 'Demo account cannot be deleted' }, { status: 403 });
    }

    const deleted: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const playerId of playerIds) {
      try {
        // Clean up storage buckets
        for (const bucket of USER_STORAGE_BUCKETS) {
          try {
            const { data: files } = await adminDb.storage.from(bucket).list(playerId);
            if (files && files.length > 0) {
              const filePaths = files.map(f => `${playerId}/${f.name}`);
              await adminDb.storage.from(bucket).remove(filePaths);
            }
          } catch (storageError) {
            console.error('Failed to clean up %s for %s:', bucket, playerId, storageError);
          }
        }

        // Delete user (cascades all data)
        const { error: deleteError } = await adminDb.auth.admin.deleteUser(playerId);
        if (deleteError) {
          errors.push({ id: playerId, error: deleteError.message });
        } else {
          deleted.push(playerId);
        }
      } catch (err) {
        errors.push({
          id: playerId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Audit log
    await adminDb.rpc('log_admin_action', {
      p_admin_id: user.id,
      p_action_type: 'delete',
      p_entity_type: 'player',
      p_entity_id: playerIds[0],
      p_entity_name: null,
      p_old_data: null,
      p_new_data: null,
      p_metadata: { player_ids: playerIds, deleted, errors, count: playerIds.length },
      p_severity: 'critical',
    });

    if (errors.length > 0 && deleted.length === 0) {
      return NextResponse.json(
        { error: 'Failed to delete players', details: errors },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleted.length,
      deletedIds: deleted,
      ...(errors.length > 0 && { errors }),
    });
  } catch (error) {
    console.error('Admin players DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
