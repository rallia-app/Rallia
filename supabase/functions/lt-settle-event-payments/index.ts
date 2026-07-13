/**
 * lt-settle-event-payments  (cron)
 *
 * v0 model: the entry always settles into the organizer's connected Stripe
 * balance at charge time (destination charge). This cron drives the two
 * terminal transitions:
 *
 *   COMPLETED (end_date + 24h)  → PAYOUT the organizer's share
 *     (organizer_amount_cents) from their connected balance to their bank.
 *     Rallia only decides the timing — it never held the money.
 *
 *   CANCELLED  → full ENTRY refund to every paid player (service fee retained).
 *     reverse_transfer claws the entry back from the organizer's balance to
 *     fund the refund.
 *
 * Idempotent: candidate RPCs only return un-paid-out / un-refunded rows, and
 * every Stripe call is keyed by payment id.
 *
 * Invoked by pg_cron (see the companion migration). Env: STRIPE_SECRET_KEY,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { requireSecretApikey } from '../_shared/auth.ts';

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

interface ReleaseRow {
  payment_id: string;
  organizer_id: string;
  organizer_amount_cents: number;
  currency: string;
  organizer_stripe_account_id: string | null;
  organizer_onboarded: boolean;
}

interface CancelRow {
  payment_id: string;
  stripe_payment_intent_id: string | null;
  entry_cents: number;
}

async function releaseCompleted(admin: Admin, stripe: Stripe): Promise<number> {
  const { data: rows } = await admin.rpc('lt_release_candidates');
  const candidates = (rows ?? []) as ReleaseRow[];
  let released = 0;

  for (const row of candidates) {
    // Organizer not (yet) ready — leave it; a later run retries.
    if (!row.organizer_onboarded || !row.organizer_stripe_account_id) continue;
    try {
      // The entry already sits in the organizer's connected balance (it settled
      // there at charge time). "Release" = a payout of their share from that
      // balance to their bank; Rallia only decides the timing, never holds it.
      // If the charge funds haven't cleared to available yet the payout throws
      // insufficient_funds — harmless, a later run retries once cleared.
      const payout = await stripe.payouts.create(
        {
          amount: row.organizer_amount_cents,
          currency: row.currency.toLowerCase(),
          metadata: { rallia_flow: 'lt_release', paymentId: row.payment_id },
        },
        {
          idempotencyKey: `lt-release-${row.payment_id}`,
          stripeAccount: row.organizer_stripe_account_id,
        }
      );
      await admin
        .from('lt_registration_payment')
        .update({
          stripe_payout_id: payout.id,
          released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.payment_id)
        .is('stripe_payout_id', null);
      released += 1;
    } catch (e) {
      console.error('[lt-settle] release failed', row.payment_id, e);
    }
  }
  return released;
}

async function refundCancelled(admin: Admin, stripe: Stripe): Promise<number> {
  const { data: rows } = await admin.rpc('lt_cancel_refund_candidates');
  const candidates = (rows ?? []) as CancelRow[];
  let refunded = 0;

  for (const row of candidates) {
    if (!row.stripe_payment_intent_id || row.entry_cents <= 0) continue;
    try {
      // The entry sits in the organizer's connected balance; reverse_transfer
      // claws it back to fund the player's refund, and refund_application_fee:
      // false keeps Rallia's service fee.
      await stripe.refunds.create(
        {
          payment_intent: row.stripe_payment_intent_id,
          amount: row.entry_cents,
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: {
            rallia_flow: 'lt_registration',
            paymentId: row.payment_id,
            reason: 'event_cancelled',
          },
        },
        { idempotencyKey: `lt-cancel-refund-${row.payment_id}` }
      );

      await admin
        .from('lt_registration_payment')
        .update({
          status: 'refunded',
          refund_amount_cents: row.entry_cents,
          refunded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.payment_id)
        .eq('status', 'succeeded');
      refunded += 1;
    } catch (e) {
      console.error('[lt-settle] cancel refund failed', row.payment_id, e);
    }
  }
  return refunded;
}

Deno.serve(async req => {
  // Server-to-server only (pg_cron). The companion cron sends the secret key in
  // the `apikey:` header; reject anything else so this money-moving job can't be
  // triggered by arbitrary callers.
  const authError = requireSecretApikey(req);
  if (authError) return authError;

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const released = await releaseCompleted(admin, stripe);
    const refunded = await refundCancelled(admin, stripe);

    return new Response(JSON.stringify({ released, refunded }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[lt-settle-event-payments]', e);
    return new Response('handler failed', { status: 500 });
  }
});
