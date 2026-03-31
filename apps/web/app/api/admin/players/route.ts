import { isAdmin } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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

    if (action !== 'suspend') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const { error } = await supabase
      .from('profile')
      .update({ account_status: 'suspended' })
      .in('id', playerIds);

    if (error) {
      console.error('Error suspending players:', error);
      return NextResponse.json({ error: 'Failed to suspend players' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      updatedCount: playerIds.length,
    });
  } catch (error) {
    console.error('Admin players PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
