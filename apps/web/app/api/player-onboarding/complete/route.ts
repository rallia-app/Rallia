import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { MIN_AVAILABILITY_CELLS, meetsMinimumAge } from '@rallia/shared-utils';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { writeWebOnboardingProfile } from '@/lib/web-onboarding/profile';
import {
  isValidAvailabilityCell,
  writeFavoriteFacilities,
  writePlayerAvailability,
} from '@/lib/web-onboarding/player-extras';

/** Accepts seed/test IDs (e.g. b1000000-0000-...) that fail z.uuid(). */
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * Defaults for a primary signup, matching mobile's onboarding defaults.
 *
 * Deliberately NOT DEFAULT_WEB_ONBOARDING_PREFERENCES: that set (25km, 60min, "both")
 * exists for the join and booking gates, where onboarding is a side-quest to getting
 * into one specific game and a wide net is helpful. For someone signing up to the app
 * itself, silently disagreeing with mobile about travel distance and match type would
 * hand two players different feeds for no reason they could see.
 */
const PRIMARY_SIGNUP_DEFAULTS = {
  playingHand: 'right' as const,
  matchType: 'competitive' as const,
  matchDuration: '90' as const,
  maxTravelDistance: 10,
};

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
  profilePictureUrl: z.string().url().nullable().optional(),
  location: z.object({
    postalCode: z.string().min(3).max(12),
    city: z.string().min(1).max(120),
    province: z.string().min(1).max(80),
    country: z.enum(['CA', 'US']).default('CA'),
    latitude: z.number(),
    longitude: z.number(),
    /** Optional: only present when the player picked one from address search. */
    address: z.string().min(1).max(240).optional(),
  }),
  availability: z
    .array(z.object({ day: z.string(), hour: z.number().int() }))
    .min(MIN_AVAILABILITY_CELLS, { message: 'AVAILABILITY_REQUIRED' })
    .refine(cells => cells.every(isValidAvailabilityCell), { message: 'AVAILABILITY_INVALID' }),
  favoriteFacilityIds: z.array(uuidLike).min(2, { message: 'FAVORITES_REQUIRED' }),
});

/**
 * Completes onboarding for a player who signed up on the web.
 *
 * Writes the profile through the same writeWebOnboardingProfile the /games join gate and
 * /courts booking gate use, then adds the two things those gates never collect —
 * availability and favourite facilities — so the resulting account matches what mobile
 * onboarding produces rather than a subset of it.
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
        postalCode: body.location.postalCode,
        address: body.location.address,
        city: body.location.city,
        province: body.location.province,
        latitude: body.location.latitude,
        longitude: body.location.longitude,
        playingHand: PRIMARY_SIGNUP_DEFAULTS.playingHand,
        matchType: PRIMARY_SIGNUP_DEFAULTS.matchType,
        locale: body.locale,
      },
      { acquisitionChannel: 'web_app' }
    );

    // writeWebOnboardingProfile has no photo parameter (the join and booking gates never
    // collect one), so the avatar is written alongside it rather than through it.
    if (body.profilePictureUrl !== undefined) {
      const { error: pictureError } = await admin
        .from('profile')
        .update({ profile_picture_url: body.profilePictureUrl })
        .eq('id', user.id);
      if (pictureError) {
        throw new Error(`Failed to save profile picture: ${pictureError.message}`);
      }
    }

    // Columns writeWebOnboardingProfile does not carry: country (mobile writes it from
    // the geocode) and the primary-signup travel/duration defaults.
    const { error: playerError } = await admin
      .from('player')
      .update({
        country: body.location.country,
        max_travel_distance: PRIMARY_SIGNUP_DEFAULTS.maxTravelDistance,
      })
      .eq('id', user.id);
    if (playerError) throw new Error(`Failed to save player details: ${playerError.message}`);

    const { error: sportError } = await admin
      .from('player_sport')
      .update({ preferred_match_duration: PRIMARY_SIGNUP_DEFAULTS.matchDuration })
      .eq('player_id', user.id)
      .eq('sport_id', body.sportId);
    if (sportError) throw new Error(`Failed to save sport preferences: ${sportError.message}`);

    await writePlayerAvailability(admin, user.id, body.availability);
    await writeFavoriteFacilities(admin, user.id, body.sportId, body.favoriteFacilityIds);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const codes = new Set(error.issues.map(issue => issue.message));
      const known = [
        'MINIMUM_AGE',
        'AVAILABILITY_REQUIRED',
        'AVAILABILITY_INVALID',
        'FAVORITES_REQUIRED',
      ];
      const matched = known.find(code => codes.has(code));
      return NextResponse.json(
        { error: matched ?? 'INVALID_REQUEST', details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'An error occurred';
    console.error('[player-onboarding/complete]', message);
    return NextResponse.json({ error: 'SUBMIT_FAILED' }, { status: 500 });
  }
}
