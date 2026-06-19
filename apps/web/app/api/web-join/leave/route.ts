import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getTimeDifferenceFromNow } from '@rallia/shared-utils';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { leaveWebJoinMatch } from '@/lib/web-join/complete';

/** Accepts seed/test IDs (e.g. b1000000-0000-0000-0000-000000000001) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const LeaveSchema = z.object({ matchId: uuidLike });

function toLeaveErrorCode(message: string): string {
  switch (message) {
    case 'Match not found':
      return 'MATCH_UNAVAILABLE';
    default:
      return 'LEAVE_FAILED';
  }
}

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

    const { matchId } = LeaveSchema.parse(await request.json());

    const admin = createServiceRoleClient();
    const { data: match, error: matchError } = await admin
      .from('match')
      .select('match_date, start_time, timezone')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json({ error: 'MATCH_UNAVAILABLE' }, { status: 404 });
    }

    // Only allow leaving before the match starts.
    const tz = match.timezone || 'UTC';
    if (getTimeDifferenceFromNow(match.match_date, match.start_time, tz) <= 0) {
      return NextResponse.json({ error: 'MATCH_STARTED' }, { status: 400 });
    }

    try {
      await leaveWebJoinMatch(admin, user.id, matchId);
    } catch (err) {
      // Already out of the match — treat as success (idempotent).
      if (!(err instanceof Error && err.message === 'You are not a participant in this match')) {
        throw err;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[web-join/leave]', message);
    const code = toLeaveErrorCode(message);
    return NextResponse.json({ error: code }, { status: code === 'LEAVE_FAILED' ? 500 : 400 });
  }
}
