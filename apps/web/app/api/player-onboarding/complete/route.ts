import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { meetsMinimumAge } from '@rallia/shared-utils';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  DEFAULT_WEB_ONBOARDING_PREFERENCES,
  writeWebOnboardingProfile,
} from '@/lib/web-onboarding/profile';

/** Accepts seed/test IDs (e.g. b1000000-0000-...) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const CompleteSchema = z.object({
  locale: z.string().default('en-US'),
  personal: z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    gender: z.enum(['male', 'female', 'other']),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(meetsMinimumAge, { message: 'MINIMUM_AGE' }),
  }),
  sportId: uuidLike,
  ratingScoreId: uuidLike,
  location: z.object({
    postalCode: z.string().min(3).max(12),
    city: z.string().min(1).max(120),
    province: z.string().min(1).max(80),
    latitude: z.number(),
    longitude: z.number(),
  }),
});

/**
 * Completes onboarding for a player who signed up on the web.
 *
 * Writes through the same `writeWebOnboardingProfile` the /games join gate and
 * /courts booking gate use, so an account created here is shaped identically to one
 * created through those flows — same defaults, same rating source, same primary sport.
 *
 * The only difference is attribution: `web_app` rather than a referral, since nobody
 * invited this player to anything.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // The (player) layout already guards the page, but the route is reachable
    // directly, so it re-authenticates rather than trusting the caller.
    if (authError || !user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = CompleteSchema.parse(await request.json());

    const admin = createServiceRoleClient();
    await writeWebOnboardingProfile(
      admin,
      user.id,
      user.email,
      {
        ...body.personal,
        sportId: body.sportId,
        ratingScoreId: body.ratingScoreId,
        ...body.location,
        ...DEFAULT_WEB_ONBOARDING_PREFERENCES,
        locale: body.locale,
      },
      { acquisitionChannel: 'web_app' }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const isAgeFailure = error.issues.some(issue => issue.message === 'MINIMUM_AGE');
      return NextResponse.json(
        { error: isAgeFailure ? 'MINIMUM_AGE' : 'INVALID_REQUEST', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[player-onboarding/complete]', message);
    return NextResponse.json({ error: 'SUBMIT_FAILED' }, { status: 500 });
  }
}
