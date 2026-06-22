import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { meetsMinimumAge } from '@rallia/shared-utils';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  completeWebJoinProfile,
  DEFAULT_WEB_JOIN_PREFERENCES,
  joinMatchForExistingUser,
  recordWebJoin,
} from '@/lib/web-join/complete';

/** Accepts seed/test IDs (e.g. b1000000-0000-0000-0000-000000000001) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const CompleteSchema = z.object({
  matchId: uuidLike,
  locale: z.string().default('en-US'),
  personal: z
    .object({
      firstName: z.string().min(1).max(80),
      lastName: z.string().min(1).max(80),
      gender: z.enum(['male', 'female', 'other']),
      birthDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(meetsMinimumAge, { message: 'MINIMUM_AGE' }),
    })
    .optional(),
  sportId: uuidLike.optional(),
  ratingScoreId: uuidLike.optional(),
  location: z
    .object({
      postalCode: z.string().min(3).max(12),
      city: z.string().min(1).max(120),
      province: z.string().min(1).max(80),
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
  preferences: z
    .object({
      playingHand: z.enum(['left', 'right', 'both']),
      matchType: z.enum(['casual', 'competitive', 'both']),
    })
    .optional(),
});

const StatusSchema = z.object({
  matchId: uuidLike,
});

/**
 * Map internal join errors (thrown as raw strings by the shared joinMatch service)
 * to stable codes the client localizes. Unknown errors collapse to JOIN_FAILED so
 * we never surface internal English strings in the UI.
 */
function toJoinErrorCode(message: string): string {
  switch (message) {
    case 'GENDER_MISMATCH':
      return 'GENDER_MISMATCH';
    case 'Match not found':
    case 'Match is no longer available':
      return 'MATCH_UNAVAILABLE';
    case 'You are the host of this match':
      return 'ALREADY_HOST';
    case 'Could not verify player eligibility':
      return 'ELIGIBILITY_UNVERIFIED';
    default:
      return 'JOIN_FAILED';
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { matchId } = StatusSchema.parse({
      matchId: request.nextUrl.searchParams.get('matchId'),
    });

    const admin = createServiceRoleClient();
    const { data: participant, error: participantError } = await admin
      .from('match_participant')
      .select('status')
      .eq('match_id', matchId)
      .eq('player_id', user.id)
      .in('status', ['joined', 'requested', 'waitlisted'])
      .maybeSingle();

    if (participantError) {
      throw new Error(participantError.message);
    }

    return NextResponse.json({
      joinStatus: participant?.status ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[web-join/complete:status]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = CompleteSchema.parse(await request.json());
    const { matchId } = body;

    const admin = createServiceRoleClient();
    const { data: match, error: matchError } = await admin
      .from('match')
      .select('id, visibility, cancelled_at')
      .eq('id', matchId)
      .single();

    if (matchError || !match || match.cancelled_at || match.visibility !== 'public') {
      return NextResponse.json({ error: 'MATCH_UNAVAILABLE' }, { status: 404 });
    }

    const { data: profile } = await admin
      .from('profile')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    let result;

    if (profile?.onboarding_completed) {
      result = await joinMatchForExistingUser(admin, user.id, matchId);
    } else {
      if (!body.personal || !body.sportId || !body.ratingScoreId || !body.location) {
        return NextResponse.json({ error: 'Incomplete profile data' }, { status: 400 });
      }

      const preferences = body.preferences ?? DEFAULT_WEB_JOIN_PREFERENCES;

      result = await completeWebJoinProfile(admin, user.id, user.email, matchId, {
        firstName: body.personal.firstName,
        lastName: body.personal.lastName,
        gender: body.personal.gender,
        birthDate: body.personal.birthDate,
        sportId: body.sportId,
        ratingScoreId: body.ratingScoreId,
        postalCode: body.location.postalCode,
        city: body.location.city,
        province: body.location.province,
        latitude: body.location.latitude,
        longitude: body.location.longitude,
        playingHand: preferences.playingHand,
        matchType: preferences.matchType,
        locale: body.locale,
      });
    }

    await recordWebJoin(admin, user.id, matchId);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      if (error.issues.some(issue => issue.message === 'MINIMUM_AGE')) {
        return NextResponse.json({ error: 'MINIMUM_AGE' }, { status: 400 });
      }
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[web-join/complete]', message);
    const code = toJoinErrorCode(message);
    const status = code === 'JOIN_FAILED' ? 500 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
