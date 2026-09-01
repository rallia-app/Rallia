import { NextRequest, NextResponse } from 'next/server';

import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

const FEEDBACK_STATUSES = ['new', 'reviewed', 'in_progress', 'resolved', 'closed'] as const;
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const MAX_ADMIN_NOTES = 2000;

/**
 * Triage one feedback submission (status, admin notes, public visibility).
 *
 * Service role on purpose: the feedback SELECT policy only exposes a player's
 * own rows plus the public board, so an admin's own session cannot read or
 * write another player's report. The role gate above is the credential.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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

    const { status, adminNotes, hidden } = (await request.json()) as {
      status?: string;
      adminNotes?: string | null;
      hidden?: boolean;
    };

    const update: {
      status?: FeedbackStatus;
      admin_notes?: string | null;
      hidden_at?: string | null;
    } = {};

    if (status !== undefined) {
      if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
        return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
      }
      update.status = status as FeedbackStatus;
    }

    if (adminNotes !== undefined) {
      const trimmed = typeof adminNotes === 'string' ? adminNotes.trim() : '';
      if (trimmed.length > MAX_ADMIN_NOTES) {
        return NextResponse.json({ error: 'NOTES_TOO_LONG' }, { status: 400 });
      }
      update.admin_notes = trimmed.length > 0 ? trimmed : null;
    }

    if (hidden !== undefined) {
      if (typeof hidden !== 'boolean') {
        return NextResponse.json({ error: 'INVALID_HIDDEN' }, { status: 400 });
      }
      update.hidden_at = hidden ? new Date().toISOString() : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 });
    }

    const adminDb = createServiceRoleClient();
    const { data, error } = await adminDb
      .from('feedback')
      .update(update)
      .eq('id', id)
      .select('id, status, admin_notes, hidden_at, updated_at')
      .single();

    if (error) {
      // PGRST116 = no row matched the id.
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      console.error('Update feedback error:', error);
      return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
    }

    return NextResponse.json({ feedback: data });
  } catch (error) {
    console.error('Update feedback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
