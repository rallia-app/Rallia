import { createDonationPaymentIntent } from '@/lib/stripe/payments';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase configuration');
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amountCents, donorName, donorEmail, donorMessage } = body;

    if (
      !amountCents ||
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents) ||
      amountCents < 50
    ) {
      return NextResponse.json(
        { error: 'Invalid amount. Minimum donation is $0.50.' },
        { status: 400 }
      );
    }

    const result = await createDonationPaymentIntent({
      amountCents,
      donorName: donorName || undefined,
      donorEmail: donorEmail || undefined,
      donorMessage: donorMessage ? String(donorMessage).slice(0, 500) : undefined,
    });

    // Best-effort DB insert — webhook reconciles if this fails
    try {
      const supabase = getAdminClient();
      await supabase.from('donations').insert({
        stripe_payment_intent_id: result.paymentIntentId,
        amount_cents: amountCents,
        currency: 'cad',
        status: 'pending',
        donor_name: donorName || null,
        donor_email: donorEmail || null,
        donor_message: donorMessage ? String(donorMessage).slice(0, 500) : null,
      });
    } catch (dbError) {
      console.error('Failed to insert pending donation row:', dbError);
    }

    return NextResponse.json({ clientSecret: result.clientSecret });
  } catch (error) {
    console.error('Error creating donation payment intent:', error);
    return NextResponse.json({ error: 'Failed to create payment.' }, { status: 500 });
  }
}
