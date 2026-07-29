import { normalizePostalCode, validateEmail, validatePhoneNumber } from '@rallia/shared-utils';
import { NextRequest, NextResponse } from 'next/server';

import { getAdminClient } from '@/lib/match-smoke-test/admin';
import {
  ALL_RATING_OPTIONS,
  DEFAULT_MATCH_FORMAT,
  DISTANCE_OPTIONS_KM,
  FACILITY_PREFERENCE_OPTIONS,
  LOCATION_OPTIONS,
  MATCH_NATURE_OPTIONS,
  SPORT_OPTIONS,
  isValidMonthlyPrice,
  type FacilityPreference,
  type LocationOption,
  type MatchNatureOption,
  type SportOption,
} from '@/lib/match-smoke-test/constants';
import { isWellFormedTimeSlot } from '@/lib/match-smoke-test/time-selection';

/**
 * Captures the visitor's contact details at the contact step — BEFORE any price
 * is shown — so interest can be measured independently of price and we keep the
 * lead even if the person never reaches the pricing screen. No plan is chosen
 * yet, so plan columns stay null.
 *
 * The street address is never accepted here: step 2 takes an address or a postal
 * code, and only the postal code, city and region are kept.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sport,
      rating,
      matchNature,
      timeSlot,
      locationType,
      postalCode,
      homeCity,
      homeRegion,
      maxDistanceKm,
      facilityId,
      facilityPreference,
      city,
      email,
      phone,
      langue,
      sessionId,
      variantValueProp,
      variantPriceCents,
    } = body;

    if (!sport || !SPORT_OPTIONS.includes(sport as SportOption)) {
      return NextResponse.json({ error: 'Invalid sport.' }, { status: 400 });
    }
    if (!rating || !ALL_RATING_OPTIONS.includes(String(rating))) {
      return NextResponse.json({ error: 'Invalid rating.' }, { status: 400 });
    }
    if (!matchNature || !MATCH_NATURE_OPTIONS.includes(matchNature as MatchNatureOption)) {
      return NextResponse.json({ error: 'Invalid match type.' }, { status: 400 });
    }
    if (!timeSlot || typeof timeSlot !== 'string' || !isWellFormedTimeSlot(timeSlot)) {
      return NextResponse.json({ error: 'Invalid time slot.' }, { status: 400 });
    }

    const normalizedEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }

    const phoneDigits = validatePhoneNumber(String(phone ?? ''));
    if (phoneDigits.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 });
    }

    if (!LOCATION_OPTIONS.includes(locationType as LocationOption)) {
      return NextResponse.json({ error: 'Invalid location type.' }, { status: 400 });
    }

    // The street address is deliberately never accepted or stored — the visitor's
    // postal code and city are all the density analysis needs.
    if (facilityId != null && typeof facilityId !== 'string') {
      return NextResponse.json({ error: 'Invalid facility.' }, { status: 400 });
    }
    if (
      facilityPreference != null &&
      !FACILITY_PREFERENCE_OPTIONS.includes(facilityPreference as FacilityPreference)
    ) {
      return NextResponse.json({ error: 'Invalid facility preference.' }, { status: 400 });
    }

    const normalizedPostal = postalCode
      ? (normalizePostalCode(String(postalCode))?.normalized ?? null)
      : null;
    const normalizedCity = city ? String(city).trim().slice(0, 120) : null;
    const normalizedHomeCity = homeCity ? String(homeCity).trim().slice(0, 120) : null;
    const normalizedHomeRegion = homeRegion ? String(homeRegion).trim().slice(0, 40) : null;
    const normalizedMaxDistance = (DISTANCE_OPTIONS_KM as readonly number[]).includes(
      Number(maxDistanceKm)
    )
      ? Number(maxDistanceKm)
      : null;
    const normalizedLangue = langue === 'fr' || langue === 'en' ? langue : null;
    const normalizedSessionId = sessionId ? String(sessionId).slice(0, 80) : null;
    const normalizedVariantValueProp =
      variantValueProp === 'A' || variantValueProp === 'B' ? variantValueProp : null;
    const normalizedVariantPrice = isValidMonthlyPrice(variantPriceCents)
      ? variantPriceCents
      : null;

    const supabase = getAdminClient();
    const { error: upsertError } = await supabase.from('match_smoke_test_lead').upsert(
      {
        email: normalizedEmail,
        phone: phoneDigits,
        sport: String(sport),
        rating: String(rating),
        match_format: DEFAULT_MATCH_FORMAT,
        match_nature: String(matchNature),
        time_slot: String(timeSlot),
        location_type: String(locationType),
        postal_code: normalizedPostal,
        city: normalizedCity,
        home_city: normalizedHomeCity,
        home_region: normalizedHomeRegion,
        max_distance_km: normalizedMaxDistance,
        facility_id: facilityId ?? null,
        facility_preference: facilityPreference ?? null,
        langue: normalizedLangue,
        session_id: normalizedSessionId,
        variant_valueprop: normalizedVariantValueProp,
        variant_price_cents: normalizedVariantPrice,
      },
      { onConflict: 'email' }
    );

    if (upsertError) {
      console.error('Failed to capture match smoke test lead:', upsertError);
      return NextResponse.json({ error: 'Failed to save your info.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error capturing match smoke test lead:', error);
    return NextResponse.json({ error: 'Failed to save your info.' }, { status: 500 });
  }
}
