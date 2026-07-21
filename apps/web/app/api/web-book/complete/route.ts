import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { meetsMinimumAge } from '@rallia/shared-utils';

import { getFacilityForWebBooking } from '@/app/[locale]/(marketing)/book/facility/[facilityId]/_lib/facility-context';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  DEFAULT_WEB_ONBOARDING_PREFERENCES,
  writeWebOnboardingProfile,
} from '@/lib/web-onboarding/profile';

/** Accepts seed/test IDs (e.g. b1000000-0000-0000-0000-000000000001) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const CompleteSchema = z.object({
  facilityId: uuidLike,
  /** Provider slot id from the card the visitor clicked. Matched against our own rows. */
  slotId: z.string().max(200).nullish(),
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
});

/**
 * Finishes the /courts signup gate and hands back the external booking URL.
 *
 * The URL is always re-resolved server-side from the facility's own snapshot
 * rows or provider template — the client never supplies a destination, so this
 * route can't be used as an open redirect.
 */
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

    const facility = await getFacilityForWebBooking(body.facilityId, body.slotId ?? null);
    if (!facility) {
      return NextResponse.json({ error: 'FACILITY_UNAVAILABLE' }, { status: 404 });
    }

    const admin = createServiceRoleClient();
    const { data: profile } = await admin
      .from('profile')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    const existingUser = Boolean(profile?.onboarding_completed);

    if (!existingUser) {
      if (!body.personal || !body.sportId || !body.ratingScoreId || !body.location) {
        return NextResponse.json({ error: 'Incomplete profile data' }, { status: 400 });
      }

      await writeWebOnboardingProfile(
        admin,
        user.id,
        user.email,
        {
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
          playingHand: DEFAULT_WEB_ONBOARDING_PREFERENCES.playingHand,
          matchType: DEFAULT_WEB_ONBOARDING_PREFERENCES.matchType,
          locale: body.locale,
        },
        {
          acquisitionChannel: 'web_book',
          referralInvitationType: 'facility',
          referralTargetId: facility.id,
        }
      );
    }

    if (!facility.bookingUrl) {
      return NextResponse.json({ error: 'NO_BOOKING_URL' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      existingUser,
      bookingUrl: facility.bookingUrl,
    });
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
    console.error('[web-book/complete]', message);
    return NextResponse.json({ error: 'BOOK_FAILED' }, { status: 500 });
  }
}
