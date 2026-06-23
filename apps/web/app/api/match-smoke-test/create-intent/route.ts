import { createMatchUnlockPaymentIntent } from '@/lib/stripe/payments';
import {
  MATCH_FORMAT_OPTIONS,
  MATCH_NATURE_OPTIONS,
  MATCH_PLAN_TIERS,
  MATCH_PLANS,
  RATING_OPTIONS,
  type MatchPlanTier,
} from '@/lib/match-smoke-test/constants';
import { isValidTimeSlot } from '@/lib/match-smoke-test/time-selection';
import { validateEmail } from '@rallia/shared-utils';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      rating,
      matchFormat,
      matchNature,
      timeSlot,
      locationType,
      homeAddress,
      postalCode,
      facilityId,
      facilityName,
      planTier,
      email,
    } = body;

    if (!rating || !RATING_OPTIONS.includes(rating)) {
      return NextResponse.json({ error: 'Invalid rating.' }, { status: 400 });
    }

    const normalizedEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }
    if (!matchFormat || !MATCH_FORMAT_OPTIONS.includes(matchFormat)) {
      return NextResponse.json({ error: 'Invalid format.' }, { status: 400 });
    }
    if (!matchNature || !MATCH_NATURE_OPTIONS.includes(matchNature)) {
      return NextResponse.json({ error: 'Invalid match type.' }, { status: 400 });
    }
    if (!timeSlot || typeof timeSlot !== 'string' || !isValidTimeSlot(timeSlot)) {
      return NextResponse.json({ error: 'Invalid time slot.' }, { status: 400 });
    }
    if (!planTier || !MATCH_PLAN_TIERS.includes(planTier as MatchPlanTier)) {
      return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
    }

    const plan = MATCH_PLANS[planTier as MatchPlanTier];
    if (!plan.purchasable) {
      return NextResponse.json({ error: 'This plan is not available yet.' }, { status: 400 });
    }

    if (locationType !== 'address') {
      return NextResponse.json({ error: 'Invalid location type.' }, { status: 400 });
    }

    const normalizedAddress = String(homeAddress ?? '').trim();
    if (normalizedAddress.length < 5) {
      return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
    }
    if (facilityId != null && typeof facilityId !== 'string') {
      return NextResponse.json({ error: 'Invalid facility.' }, { status: 400 });
    }

    const normalizedPostal = postalCode
      ? String(postalCode).trim().toUpperCase().replace(/\s+/g, ' ')
      : '';

    const result = await createMatchUnlockPaymentIntent({
      amountCents: plan.amountCents,
      metadata: {
        rating: String(rating),
        match_format: String(matchFormat),
        match_nature: String(matchNature),
        time_slot: String(timeSlot),
        location_type: String(locationType),
        home_address: normalizedAddress,
        postal_code: normalizedPostal,
        facility_id: facilityId ? String(facilityId) : '',
        facility_name: facilityName ? String(facilityName) : '',
        plan_tier: plan.tier,
        credits: plan.credits !== null ? String(plan.credits) : '',
        email: normalizedEmail,
      },
    });

    return NextResponse.json({
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amountCents: plan.amountCents,
      planTier: plan.tier,
      credits: plan.credits,
    });
  } catch (error) {
    console.error('Error creating match smoke test payment intent:', error);
    return NextResponse.json({ error: 'Failed to create payment.' }, { status: 500 });
  }
}
