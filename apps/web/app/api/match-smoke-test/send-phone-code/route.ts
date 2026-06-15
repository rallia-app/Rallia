import { getPaymentIntent } from '@/lib/stripe/payments';
import { getAdminClient } from '@/lib/match-smoke-test/admin';
import {
  generateOtpCode,
  isValidE164Phone,
  toE164NorthAmerica,
} from '@/lib/match-smoke-test/phone';
import { isTwilioConfigured, sendSms } from '@/lib/match-smoke-test/twilio';
import { NextRequest, NextResponse } from 'next/server';

const CODE_TTL_MINUTES = 10;

function isDevOtpAllowed(): boolean {
  if (process.env.MATCH_SMOKE_TEST_ALLOW_DEV_OTP === 'false') return false;
  if (process.env.MATCH_SMOKE_TEST_ALLOW_DEV_OTP === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

async function assertPaidMatchSmokeIntent(paymentIntentId: string) {
  const paymentIntent = await getPaymentIntent(paymentIntentId);
  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment not completed.');
  }
  if (paymentIntent.metadata?.type !== 'match_smoke_test') {
    throw new Error('Invalid payment.');
  }
  return paymentIntent;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phoneDigits, paymentIntentId } = body;

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return NextResponse.json({ error: 'Missing payment reference.' }, { status: 400 });
    }

    const e164 = toE164NorthAmerica(String(phoneDigits ?? ''));
    if (!e164 || !isValidE164Phone(e164)) {
      return NextResponse.json({ error: 'Enter a valid 10-digit phone number.' }, { status: 400 });
    }

    await assertPaidMatchSmokeIntent(paymentIntentId);

    const supabase = getAdminClient();
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from('match_smoke_test_phone_code').insert({
      phone: e164,
      code,
      payment_intent_id: paymentIntentId,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error('Failed to store phone code:', insertError);
      return NextResponse.json({ error: 'Failed to send verification code.' }, { status: 500 });
    }

    const message = `Rallia: your verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`;

    if (isTwilioConfigured()) {
      await sendSms(e164, message);
      return NextResponse.json({ ok: true });
    }

    if (isDevOtpAllowed()) {
      console.info(`[match-smoke-test] Dev OTP for ${e164}: ${code}`);
      return NextResponse.json({ ok: true, devCode: code });
    }

    return NextResponse.json({ error: 'SMS is not configured.' }, { status: 503 });
  } catch (error) {
    console.error('Error sending phone verification code:', error);
    const message = error instanceof Error ? error.message : 'Failed to send code.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
