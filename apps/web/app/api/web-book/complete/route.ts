import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { MIN_FAVORITE_FACILITIES, meetsMinimumAge } from '@rallia/shared-utils';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  DEFAULT_WEB_ONBOARDING_PREFERENCES,
  OnboardingIncompleteError,
  completeOnboarding,
  writeWebOnboardingProfile,
} from '@/lib/web-onboarding/profile';
import { writeFavoriteFacilities } from '@/lib/web-onboarding/player-extras';

/** Accepts seed/test IDs (e.g. b1000000-0000-0000-0000-000000000001) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const CompleteSchema = z.object({
  facilityId: uuidLike,
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
  favoriteFacilityIds: z.array(uuidLike).min(MIN_FAVORITE_FACILITIES),
});

/**
 * Finishes the /courts signup gate for a brand-new account. The external
 * booking destination is NOT handled here — the gate page resolves it
 * server-side from our own snapshot rows (see _lib/facility-context.ts), so
 * no redirect URL ever transits through the client.
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

    const admin = createServiceRoleClient();
    const { data: facility } = await admin
      .from('facility')
      .select('id, is_active')
      .eq('id', body.facilityId)
      .maybeSingle();

    if (!facility || facility.is_active === false) {
      return NextResponse.json({ error: 'FACILITY_UNAVAILABLE' }, { status: 404 });
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
      { acquisitionChannel: 'web_book' }
    );
    await writeFavoriteFacilities(admin, user.id, body.sportId, body.favoriteFacilityIds);
    await completeOnboarding(admin, user.id);

    return NextResponse.json({ success: true });
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

    if (error instanceof OnboardingIncompleteError) {
      return NextResponse.json({ error: error.code, missing: error.missing }, { status: 422 });
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[web-book/complete]', message);
    return NextResponse.json({ error: 'BOOK_FAILED' }, { status: 500 });
  }
}
