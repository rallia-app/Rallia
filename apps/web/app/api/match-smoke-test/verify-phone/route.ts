import { getPaymentIntent } from '@/lib/stripe/payments';
import { getAdminClient } from '@/lib/match-smoke-test/admin';
import { isValidE164Phone, toE164NorthAmerica } from '@/lib/match-smoke-test/phone';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phoneDigits, code, paymentIntentId } = body;

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return NextResponse.json({ error: 'Missing payment reference.' }, { status: 400 });
    }

    const normalizedCode = String(code ?? '').replace(/\D/g, '');
    if (normalizedCode.length !== 6) {
      return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
    }

    const e164 = toE164NorthAmerica(String(phoneDigits ?? ''));
    if (!e164 || !isValidE164Phone(e164)) {
      return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
    }

    const paymentIntent = await getPaymentIntent(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment not completed.' }, { status: 400 });
    }
    if (paymentIntent.metadata?.type !== 'match_smoke_test') {
      return NextResponse.json({ error: 'Invalid payment.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const now = new Date().toISOString();

    const { data: rows, error: lookupError } = await supabase
      .from('match_smoke_test_phone_code')
      .select('id, code, expires_at, used')
      .eq('phone', e164)
      .eq('payment_intent_id', paymentIntentId)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lookupError || !rows?.length) {
      return NextResponse.json(
        { error: 'No active code found. Request a new one.' },
        { status: 400 }
      );
    }

    const row = rows[0]!;
    if (row.used) {
      return NextResponse.json({ error: 'Code already used.' }, { status: 400 });
    }
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 400 });
    }
    if (row.code !== normalizedCode) {
      return NextResponse.json({ error: 'Incorrect code. Try again.' }, { status: 400 });
    }

    await supabase
      .from('match_smoke_test_phone_code')
      .update({ used: true, used_at: now })
      .eq('id', row.id);

    const meta = paymentIntent.metadata;
    const creditsRaw = meta.credits;
    const credits = creditsRaw ? Number.parseInt(creditsRaw, 10) : null;

    await supabase.from('match_smoke_test_lead').upsert(
      {
        payment_intent_id: paymentIntentId,
        phone: e164,
        phone_verified: true,
        verified_at: now,
        rating: meta.rating ?? '',
        match_format: meta.match_format ?? '',
        match_nature: meta.match_nature ?? '',
        time_slot: meta.time_slot ?? '',
        location_type: meta.location_type ?? '',
        postal_code: meta.postal_code || null,
        plan_tier: meta.plan_tier ?? '',
        credits: Number.isFinite(credits) ? credits : null,
        amount_cents: paymentIntent.amount,
      },
      { onConflict: 'payment_intent_id' }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error verifying phone code:', error);
    return NextResponse.json({ error: 'Verification failed.' }, { status: 500 });
  }
}
