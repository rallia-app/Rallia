/**
 * lt-payment-webhook
 *
 * Receives Stripe webhook events for paid tournament / league-season
 * registrations (metadata.rallia_flow === 'lt_registration'). Finalizes the
 * registration ledger written by tournament_begin_paid_registration or
 * season_begin_paid_enrollment.
 *
 * Both legs share this endpoint and the same rallia_flow marker: the leg is
 * resolved from the ledger row, whose target CHECK guarantees exactly one of
 * tournament_registration_id / season_user_id is set.
 *
 *   payment_intent.succeeded
 *     - Mark lt_registration_payment.status = 'succeeded', store charge id.
 *     - Flip the reserved slot 'payment_pending' → 'registered' (tournament) or
 *       → 'enrolled' (season, which also seeds the payer's season_rankings row).
 *       (For hold_until_event_end the funds stay in Rallia's balance until the
 *       event ends; the payout is released by Phase 3's event-end job.)
 *
 *   payment_intent.payment_failed | payment_intent.canceled
 *     - Mark the ledger 'failed' / 'cancelled' and release the reserved slot
 *       (→ 'withdrawn'). The reaper would catch it eventually, but freeing it
 *       immediately is friendlier.
 *
 * Idempotent: re-deliveries are no-ops once the ledger row is terminal.
 *
 * Configure in Stripe Dashboard:
 *   Endpoint: https://<project>.supabase.co/functions/v1/lt-payment-webhook
 *   Events: payment_intent.succeeded, payment_intent.payment_failed,
 *           payment_intent.canceled
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_LT_WEBHOOK_SECRET, SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

Deno.serve(async req => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
  const webhookSecret = Deno.env.get('STRIPE_LT_WEBHOOK_SECRET')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    // Deno edge runtime uses async Web Crypto — must use constructEventAsync.
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e) {
    console.error('[lt-payment-webhook] invalid signature:', e);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handleSucceeded(admin, event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleTerminal(admin, event.data.object, 'failed');
        break;
      case 'payment_intent.canceled':
        await handleTerminal(admin, event.data.object, 'cancelled');
        break;
      default:
        console.log('[lt-payment-webhook] unhandled event type:', event.type);
    }
  } catch (e) {
    console.error('[lt-payment-webhook] handler failed:', e);
    return new Response('handler failed', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

function isOurFlow(pi: Stripe.PaymentIntent): boolean {
  return pi.metadata?.rallia_flow === 'lt_registration';
}

async function handleSucceeded(admin: Admin, pi: Stripe.PaymentIntent): Promise<void> {
  if (!isOurFlow(pi)) return;

  const { data: row } = await admin
    .from('lt_registration_payment')
    .select('id, status, tournament_registration_id, season_user_id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle();
  if (!row) {
    console.error('[lt-payment-webhook] no ledger row for PI', pi.id);
    return;
  }
  if (row.status === 'succeeded') return; // idempotent re-delivery

  const chargeId =
    typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null);

  await admin
    .from('lt_registration_payment')
    .update({
      status: 'succeeded',
      stripe_charge_id: chargeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .neq('status', 'succeeded');

  // Finalize the reserved registration. Conditional so re-deliveries / manual
  // edits don't clobber a withdrawn/disqualified state. The ledger's target
  // CHECK guarantees exactly one of these legs is set.
  if (row.tournament_registration_id) {
    await admin
      .from('tournament_registrations')
      .update({ status: 'registered', approved_at: new Date().toISOString() })
      .eq('id', row.tournament_registration_id)
      .eq('status', 'payment_pending');
  } else if (row.season_user_id) {
    // 'enrolled' also fires the trigger that seeds this payer's ranking row.
    await admin
      .from('season_members')
      .update({ status: 'enrolled', enrolled_at: new Date().toISOString() })
      .eq('id', row.season_user_id)
      .eq('status', 'payment_pending');
  }
}

async function handleTerminal(
  admin: Admin,
  pi: Stripe.PaymentIntent,
  status: 'failed' | 'cancelled'
): Promise<void> {
  if (!isOurFlow(pi)) return;

  const { data: row } = await admin
    .from('lt_registration_payment')
    .select('id, status, tournament_registration_id, season_user_id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle();
  if (!row) return;
  // Don't override a row that already succeeded (a late failure on a retried PI).
  if (
    row.status === 'succeeded' ||
    row.status === 'refunded' ||
    row.status === 'partially_refunded'
  )
    return;
  if (row.status === status) return;

  await admin
    .from('lt_registration_payment')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', row.id);

  // Free the reserved slot.
  if (row.tournament_registration_id) {
    await admin
      .from('tournament_registrations')
      .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
      .eq('id', row.tournament_registration_id)
      .eq('status', 'payment_pending');
  } else if (row.season_user_id) {
    await admin
      .from('season_members')
      .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
      .eq('id', row.season_user_id)
      .eq('status', 'payment_pending');
  }
}
