/**
 * POST /api/stripe/webhooks
 *
 * Handles Stripe webhook events for Connect accounts.
 * Processes account updates, payment events, etc.
 */

import { verifyWebhookSignature, handleAccountUpdated } from '@/lib/stripe';
import {
  confirmBookingPayment,
  markBookingPaymentFailed,
  updateBookingRefundStatus,
} from '@rallia/shared-services';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Use admin client for webhook processing (bypasses RLS)
function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration for webhook processing');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  try {
    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Handle different event types
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await handleAccountUpdatedEvent(supabase, account);
        break;
      }

      case 'account.application.deauthorized': {
        // For deauthorization events, we use event.account (the connected account ID)
        // not event.data.object which is the Application
        const accountId = event.account;
        if (accountId) {
          await handleAccountDeauthorizedById(supabase, accountId);
        }
        break;
      }

      // Payment events for Phase 1E
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(supabase, paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailed(supabase, paymentIntent);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(supabase, charge);
        break;
      }

      default:
        // Log unhandled events for debugging
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

/**
 * Handle account.updated event
 * Updates the organization_stripe_account with latest status
 */
async function handleAccountUpdatedEvent(
  supabase: ReturnType<typeof getAdminClient>,
  account: Stripe.Account
) {
  const updates = handleAccountUpdated(account);

  const { error } = await supabase
    .from('organization_stripe_account')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_account_id', account.id);

  if (error) {
    console.error('Error updating Stripe account status:', error);
    throw error;
  }

  console.log(
    `Updated Stripe account ${account.id}: charges=${updates.charges_enabled}, payouts=${updates.payouts_enabled}`
  );
}

/**
 * Handle account deauthorization by account ID
 * Marks the account as disconnected
 */
async function handleAccountDeauthorizedById(
  supabase: ReturnType<typeof getAdminClient>,
  accountId: string
) {
  const { error } = await supabase
    .from('organization_stripe_account')
    .update({
      onboarding_complete: false,
      charges_enabled: false,
      payouts_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_account_id', accountId);

  if (error) {
    console.error('Error handling account deauthorization:', error);
    throw error;
  }

  console.log(`Deauthorized Stripe account ${accountId}`);
}

/**
 * Handle successful payment intent (Phase 1E)
 * Updates booking status to confirmed
 */
async function handlePaymentIntentSucceeded(
  supabase: ReturnType<typeof getAdminClient>,
  paymentIntent: Stripe.PaymentIntent
) {
  if (paymentIntent.metadata?.type === 'donation') {
    const { error } = await supabase
      .from('donations')
      .update({ status: 'succeeded', updated_at: new Date().toISOString() })
      .eq('stripe_payment_intent_id', paymentIntent.id);
    if (error) throw error;
    console.log(`Donation succeeded: ${paymentIntent.id}`);
    return;
  }

  const chargeId =
    typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;

  const result = await confirmBookingPayment(supabase, paymentIntent.id, chargeId);

  if (result.success && result.bookingId) {
    console.log(`Confirmed booking ${result.bookingId} after payment success`);
  }
}

/**
 * Handle failed payment intent (Phase 1E)
 * Updates booking status to indicate payment failure
 */
async function handlePaymentIntentFailed(
  supabase: ReturnType<typeof getAdminClient>,
  paymentIntent: Stripe.PaymentIntent
) {
  const failureMessage = paymentIntent.last_payment_error?.message || 'Payment failed';

  const result = await markBookingPaymentFailed(supabase, paymentIntent.id, failureMessage);

  if (result.success && result.bookingId) {
    console.log(`Cancelled booking ${result.bookingId} after payment failure`);
  }
}

/**
 * Handle charge refunded (Phase 1E)
 * Updates booking refund status
 */
async function handleChargeRefunded(
  supabase: ReturnType<typeof getAdminClient>,
  charge: Stripe.Charge
) {
  const result = await updateBookingRefundStatus(
    supabase,
    charge.id,
    charge.amount_refunded,
    charge.refunded
  );

  if (result.success && result.bookingId) {
    console.log(`Updated refund status for booking ${result.bookingId}`);
  }
}
