import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// Mirrors the post-20260515220000 `period_enum`. Server-side gate on the
// /play lead form; the client-side AvailabilityGrid in player-interest-form.tsx
// emits these exact strings.
const VALID_PERIODS = ['early', 'morning', 'midday', 'afternoon', 'evening', 'late'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.firstName || !body.lastName || !body.email || !body.postalCode) {
      return NextResponse.json(
        { error: 'First name, last name, email, and postal code are required' },
        { status: 400 }
      );
    }

    // Validate at least one sport
    if (!body.playsTennis && !body.playsPickleball) {
      return NextResponse.json({ error: 'At least one sport must be selected' }, { status: 400 });
    }

    // Validate tennis fields
    if (body.playsTennis) {
      if (!body.tennisRatingScoreId) {
        return NextResponse.json({ error: 'Tennis rating is required' }, { status: 400 });
      }
      if (!body.favoriteTennisFacilityId && !body.favoriteTennisFacilityCustom) {
        return NextResponse.json(
          { error: 'Favorite tennis facility is required' },
          { status: 400 }
        );
      }
    }

    // Validate pickleball fields
    if (body.playsPickleball) {
      if (!body.pickleballRatingScoreId) {
        return NextResponse.json({ error: 'Pickleball rating is required' }, { status: 400 });
      }
      if (!body.favoritePickleballFacilityId && !body.favoritePickleballFacilityCustom) {
        return NextResponse.json(
          { error: 'Favorite pickleball facility is required' },
          { status: 400 }
        );
      }
    }

    // Validate weekly availability
    if (!Array.isArray(body.weeklyAvailability) || body.weeklyAvailability.length < 3) {
      return NextResponse.json(
        { error: 'At least 3 availability slots are required' },
        { status: 400 }
      );
    }

    for (const slot of body.weeklyAvailability) {
      if (!VALID_DAYS.includes(slot.day) || !VALID_PERIODS.includes(slot.period)) {
        return NextResponse.json({ error: 'Invalid availability slot' }, { status: 400 });
      }
    }

    const supabase = createServiceRoleClient();

    // Check for duplicate email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from('player_interest')
      .select('id')
      .eq('email', body.email)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('player_interest')
      .insert({
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email,
        postal_code: body.postalCode,
        plays_tennis: body.playsTennis || false,
        tennis_rating_score_id: body.playsTennis ? body.tennisRatingScoreId : null,
        favorite_tennis_facility_id: body.playsTennis
          ? body.favoriteTennisFacilityId || null
          : null,
        favorite_tennis_facility_custom: body.playsTennis
          ? body.favoriteTennisFacilityCustom || null
          : null,
        plays_pickleball: body.playsPickleball || false,
        pickleball_rating_score_id: body.playsPickleball ? body.pickleballRatingScoreId : null,
        favorite_pickleball_facility_id: body.playsPickleball
          ? body.favoritePickleballFacilityId || null
          : null,
        favorite_pickleball_facility_custom: body.playsPickleball
          ? body.favoritePickleballFacilityCustom || null
          : null,
        weekly_availability: body.weeklyAvailability,
        ip_address: body.ipAddress || null,
        location: body.location || null,
      })
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to submit player interest' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    console.error('Player interest submission error:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}
