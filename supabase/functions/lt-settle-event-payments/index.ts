/**
 * lt-settle-event-payments  (cron)
 *
 * Settles paid tournaments once they reach a terminal state:
 *
 *   COMPLETED + hold_until_event_end  → transfer the organizer's share
 *     (organizer_amount_cents, snapshotted) to their connected account. This is
 *     the payout for the default hold mode; pay_as_you_go already paid out at
 *     charge time.
 *
 *   CANCELLED  → full ENTRY refund to every paid player (the service fee is
 *     still retained). Reverses the organizer's transfer first where the money
 *     already left Rallia's balance (pay_as_you_go, or a hold payment that was
 *     somehow already released).
 *
 * Idempotent: candidate RPCs only return un-released / un-refunded rows, and
 * every Stripe call is keyed by payment id.
 *
 * Invoked by pg_cron (see the companion migration). Env: STRIPE_SECRET_KEY,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

interface ReleaseRow {
  payment_id: string;
  stripe_charge_id: string;
  organizer_id: string;
  organizer_amount_cents: number;
  currency: string;
  organizer_stripe_account_id: string | null;
  organizer_onboarded: boolean;
}

interface CancelRow {
  payment_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  entry_cents: number;
  currency: string;
  payout_timing: string;
  released_transfer_id: string | null;
}

async function releaseCompleted(admin: Admin, stripe: Stripe): Promise<number> {
  const { data: rows } = await admin.rpc('lt_release_candidates');
  const candidates = (rows ?? []) as ReleaseRow[];
  let released = 0;

  for (const row of candidates) {
    // Organizer not (yet) ready — leave it; a later run retries.
    if (!row.organizer_onboarded || !row.organizer_stripe_account_id) continue;
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: row.organizer_amount_cents,
          currency: row.currency.toLowerCase(),
          destination: row.organizer_stripe_account_id,
          source_transaction: row.stripe_charge_id,
          metadata: { rallia_flow: 'lt_release', paymentId: row.payment_id },
        },
        { idempotencyKey: `lt-release-${row.payment_id}` }
      );
      await admin
        .from('lt_registration_payment')
        .update({
          released_transfer_id: transfer.id,
          released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.payment_id)
        .is('released_transfer_id', null);
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
      // Claw back the entry from the organizer where it already left Rallia.
      if (row.payout_timing === 'pay_as_you_go' && row.stripe_charge_id) {
        const charge = await stripe.charges.retrieve(row.stripe_charge_id);
        const transferId =
          typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;
        if (transferId) {
          await stripe.transfers.createReversal(
            transferId,
            {
              amount: row.entry_cents,
              metadata: { reason: 'event_cancelled', paymentId: row.payment_id },
            },
            { idempotencyKey: `lt-cancel-reverse-${row.payment_id}` }
          );
        }
      } else if (row.released_transfer_id) {
        await stripe.transfers.createReversal(
          row.released_transfer_id,
          {
            amount: row.entry_cents,
            metadata: { reason: 'event_cancelled', paymentId: row.payment_id },
          },
          { idempotencyKey: `lt-cancel-reverse-${row.payment_id}` }
        );
      }

      await stripe.refunds.create(
        {
          payment_intent: row.stripe_payment_intent_id,
          amount: row.entry_cents,
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

Deno.serve(async () => {
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
