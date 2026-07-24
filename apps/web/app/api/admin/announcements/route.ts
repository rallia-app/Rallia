import { NextRequest, NextResponse } from 'next/server';

import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

// Map the domain errors raised by post_sport_announcement to HTTP statuses.
const RPC_ERROR_STATUS: Record<string, number> = {
  NOT_AUTHORIZED: 403,
  EMPTY_CONTENT: 400,
  CHANNEL_NOT_FOUND: 404,
};

export async function POST(request: NextRequest) {
  try {
    // User-scoped client on purpose: post_sport_announcement is SECURITY DEFINER
    // and gates on is_admin()/auth.uid() and stamps metadata.posted_by = auth.uid().
    // The service-role client has no auth.uid(), so it would fail the DB gate.
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

    const { sportId, content } = await request.json();

    if (!sportId || typeof sportId !== 'string') {
      return NextResponse.json({ error: 'Missing sportId' }, { status: 400 });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return NextResponse.json({ error: 'EMPTY_CONTENT' }, { status: 400 });
    }

    const { data: messageId, error } = await supabase.rpc('post_sport_announcement', {
      p_sport_id: sportId,
      p_content: content.trim(),
    });

    if (error) {
      const status = RPC_ERROR_STATUS[error.message] ?? 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    // Audit the broadcast. Best-effort — never fails the request. Direct insert
    // rather than log_admin_action(): that RPC has two overloads this arg set
    // matches ambiguously, so the call would silently error.
    try {
      const adminDb = createServiceRoleClient();
      const { error: auditError } = await adminDb.from('admin_audit_log').insert({
        admin_id: user.id,
        action_type: 'create',
        entity_type: 'system',
        entity_id: sportId,
        new_data: {
          kind: 'sport_announcement',
          messageId,
          sportId,
          contentLength: content.trim().length,
        },
      });
      if (auditError) {
        console.error('[Admin Announcements] audit log failed', auditError);
      }
    } catch (logError) {
      console.error('[Admin Announcements] audit log threw', logError);
    }

    return NextResponse.json({ success: true, messageId }, { status: 201 });
  } catch (error) {
    console.error('[Admin Announcements POST]', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
