/**
 * lt-reap-stale-registration-payments
 *
 * Frees slots held by paid-registration checkouts that were never completed,
 * WITHOUT stranding players who did complete one.
 *
 * Replaces the SQL cron `lt_expire_stale_registration_payments()`, which
 * released a reserved slot purely because the ledger row was still 'pending'
 * past its 15-minute TTL. That is unsafe: 'pending' is equally the state of
 * "player paid, webhook hasn't landed yet". The SQL reaper had no way to tell
 * the two apart and never told Stripe, so the PaymentIntent stayed confirmable
 * after the slot was released — the player was charged for a seat that no
 * longer existed, and lt-payment-webhook could only log ORPHANED PAYMENT.
 *
 * This version asks Stripe what each intent is actually doing:
 *
 *   requires_payment_method | requires_confirmation | requires_action | canceled
 *     - Cancel the intent AT STRIPE first, then cancel the ledger row and free
 *       the slot. Cancelling first is the whole point: once Stripe has voided
 *       the intent the player cannot be charged, so releasing the slot is safe.
 *       If Stripe refuses because the intent moved on, we re-read it and act on
 *       the new status rather than releasing anything.
 *
 *   processing | requires_capture
 *     - Money is in flight. Leave the reservation standing and push expires_at
 *       out; the webhook finalizes it, and we re-check next pass if it doesn't.
 *
 *   succeeded
 *     - The player already paid and we missed the webhook. Promote the ledger
 *       and seat them. This makes the reaper a self-heal for dropped webhook
 *       deliveries instead of the thing that strands the payer.
 *
 * A row that never reached a PaymentIntent is released with no Stripe call.
 *
 * POST /lt-reap-stale-registration-payments   (cron only — apikey guarded)
 * Success: { scanned, released, waiting, healed, failed }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { requireSecretApikey } from '../_shared/auth.ts';

import {
  classifyIntent,
  isNotCancellableError,
  WAIT_EXTENSION_MINUTES,
  type PiStatus,
  type ReapAction,
} from './reap-logic.ts';

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

interface LedgerRow {
  id: string;
  tournament_registration_id: string | null;
  season_user_id: string | null;
  stripe_payment_intent_id: string | null;
}

// Cap per invocation so one pass can't run past the function timeout. The cron
// fires every 5 minutes, so a backlog drains quickly.
const BATCH_LIMIT = 200;

Deno.serve(async req => {
  const denied = requireSecretApikey(req);
  if (denied) return denied;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  const { data: rows, error } = await admin
    .from('lt_registration_payment')
    .select('id, tournament_registration_id, season_user_id, stripe_payment_intent_id')
    .eq('status', 'pending')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[lt-reap] scan failed:', error);
    return json({ error: 'scan_failed' }, 500);
  }

  let released = 0;
  let waiting = 0;
  let healed = 0;
  let failed = 0;

  for (const row of (rows ?? []) as LedgerRow[]) {
    try {
      const action = await resolveAction(stripe, row);
      switch (action) {
        case 'cancel_and_release':
          await releaseSlot(admin, row);
          released++;
          break;
        case 'wait':
          await extendReservation(admin, row);
          waiting++;
          break;
        case 'finalize':
          await finalizeSlot(admin, stripe, row);
          healed++;
          break;
      }
    } catch (e) {
      // Never let one bad row abort the sweep. Leaving it pending is the safe
      // failure: it gets re-examined next pass, and nobody is released wrongly.
      failed++;
      console.error('[lt-reap] row failed, leaving it pending. payment_id=%s', row.id, e);
    }
  }

  const summary = { scanned: rows?.length ?? 0, released, waiting, healed, failed };
  if (healed > 0) {
    // A non-zero heal count means the webhook missed a delivery. Worth alerting
    // on: the reaper covered for it, but the webhook is the primary path.
    console.error('[lt-reap] HEALED %d payment(s) the webhook never finalized', healed);
  }
  console.log('[lt-reap]', JSON.stringify(summary));
  return json(summary);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Decide what to do with one expired row, cancelling the intent at Stripe when
 * that is the verdict. Returns the action actually taken.
 */
async function resolveAction(stripe: Stripe, row: LedgerRow): Promise<ReapAction> {
  if (!row.stripe_payment_intent_id) return 'cancel_and_release';

  const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
  const action = classifyIntent(pi.status);
  if (action !== 'cancel_and_release') return action;

  // Already dead at Stripe: nothing to cancel, just free the slot.
  if (pi.status === 'canceled') return 'cancel_and_release';

  try {
    await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
    return 'cancel_and_release';
  } catch (e) {
    if (!isNotCancellableError(e)) throw e;
    // The intent moved between our retrieve and our cancel — this is exactly the
    // race that used to charge people for released slots. Re-read and obey the
    // new status instead of releasing the slot anyway.
    const fresh = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
    const recheck = classifyIntent(fresh.status);
    if (recheck === 'cancel_and_release' && fresh.status !== 'canceled') {
      // Still nominally cancellable but Stripe won't cancel it. Don't guess.
      console.error(
        '[lt-reap] intent %s refused cancel in state %s; leaving reservation intact',
        row.stripe_payment_intent_id,
        fresh.status
      );
      return 'wait';
    }
    return recheck;
  }
}

async function releaseSlot(admin: Admin, row: LedgerRow): Promise<void> {
  const { error } = await admin
    .from('lt_registration_payment')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending');
  if (error) throw error;

  await revertReservation(admin, row);
}

async function revertReservation(admin: Admin, row: LedgerRow): Promise<void> {
  if (row.tournament_registration_id) {
    const { error } = await admin
      .from('tournament_registrations')
      .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
      .eq('id', row.tournament_registration_id)
      .eq('status', 'payment_pending');
    if (error) throw error;
  } else if (row.season_user_id) {
    const { error } = await admin
      .from('season_members')
      .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
      .eq('id', row.season_user_id)
      .eq('status', 'payment_pending');
    if (error) throw error;
  }
}

async function extendReservation(admin: Admin, row: LedgerRow): Promise<void> {
  const next = new Date(Date.now() + WAIT_EXTENSION_MINUTES * 60_000).toISOString();
  const { error } = await admin
    .from('lt_registration_payment')
    .update({ expires_at: next, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * The webhook's promote+finalize, repeated here for the case where the webhook
 * never arrived. Order matters: the ledger is marked succeeded first so the
 * paid-gate trigger on tournament_registrations sees a succeeded payment.
 */
async function finalizeSlot(admin: Admin, stripe: Stripe, row: LedgerRow): Promise<void> {
  const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id, {
    expand: ['latest_charge'],
  });
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (charge?.id ?? null);

  const { error } = await admin
    .from('lt_registration_payment')
    .update({
      status: 'succeeded',
      stripe_charge_id: chargeId,
      stripe_receipt_url: charge?.receipt_url ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending');
  if (error) throw error;

  if (row.tournament_registration_id) {
    const { error: e2 } = await admin
      .from('tournament_registrations')
      .update({ status: 'registered', approved_at: new Date().toISOString() })
      .eq('id', row.tournament_registration_id)
      .eq('status', 'payment_pending');
    if (e2) throw e2;
  } else if (row.season_user_id) {
    const { error: e2 } = await admin
      .from('season_members')
      .update({ status: 'enrolled', enrolled_at: new Date().toISOString() })
      .eq('id', row.season_user_id)
      .eq('status', 'payment_pending');
    if (e2) throw e2;
  }
}
