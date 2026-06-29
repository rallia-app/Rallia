/**
 * lt-refund-registration
 *
 * A paid player withdraws from a tournament. The SQL RPC
 * `tournament_request_refund` validates ownership, withdraws the registration
 * (optimistic-locked so a double-tap can't double-refund), and returns the
 * refundable ENTRY amount per the organizer's policy + cutoff. The service fee
 * is never refunded.
 *
 * This function executes the Stripe refund matching the event's payout model:
 *   hold_until_event_end : funds are still in Rallia's balance (unless already
 *     released at event end) → refund the entry from the charge; if it was
 *     already released, reverse that exact amount from the organizer first.
 *   pay_as_you_go        : the entry already landed on the organizer's account
 *     (destination charge) → reverse the exact entry amount from that transfer,
 *     then refund the player. `refund_application_fee:false` keeps Rallia's fee.
 *
 * POST /lt-refund-registration   (authenticated — JWT validated internally)
 * Body:    { registrationId: string, versionWas: number }
 * Success: { withdrawn: true, refundedCents: number }
 * Errors:  { error: ErrorCode }
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

type ErrorCode =
  | 'missing_auth'
  | 'invalid_auth'
  | 'invalid_body'
  | 'not_owner'
  | 'registration_not_found'
  | 'withdraw_not_allowed'
  | 'no_paid_registration'
  | 'lock_conflict'
  | 'refund_failed'
  | 'internal_error';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function err(code: ErrorCode, status = 400) {
  return json({ error: code }, status);
}

function mapRpcError(message: string | undefined): ErrorCode {
  switch (message) {
    case 'NOT_OWNER':
      return 'not_owner';
    case 'REGISTRATION_NOT_FOUND':
      return 'registration_not_found';
    case 'WITHDRAW_NOT_ALLOWED':
      return 'withdraw_not_allowed';
    case 'NO_PAID_REGISTRATION':
      return 'no_paid_registration';
    case 'OPTIMISTIC_LOCK_CONFLICT':
      return 'lock_conflict';
    default:
      return 'refund_failed';
  }
}

interface RefundPlan {
  payment_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  payout_timing: string;
  entry_cents: number;
  refundable_entry_cents: number;
  released_transfer_id: string | null;
  currency: string;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('missing_auth', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return err('invalid_auth', 401);

    let registrationId: string;
    let versionWas: number;
    try {
      const body = await req.json();
      registrationId = body?.registrationId;
      versionWas = body?.versionWas;
      if (!registrationId || typeof registrationId !== 'string') throw new Error();
      if (typeof versionWas !== 'number') throw new Error();
    } catch {
      return err('invalid_body');
    }

    // Withdraw + compute the refundable entry (as the user; SECURITY DEFINER).
    const { data: rows, error: rpcError } = await userClient.rpc('tournament_request_refund', {
      p_registration_id: registrationId,
      p_version_was: versionWas,
    });
    if (rpcError) return err(mapRpcError(rpcError.message), 400);

    const plan = (Array.isArray(rows) ? rows[0] : rows) as RefundPlan | undefined;
    if (!plan) return err('refund_failed');

    const refundable = plan.refundable_entry_cents;
    // Policy/cutoff yielded no refund — the player is withdrawn, nothing to charge back.
    if (!refundable || refundable <= 0) {
      return json({ withdrawn: true, refundedCents: 0 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
    const pi = plan.stripe_payment_intent_id;
    if (!pi) return err('refund_failed');

    // Reverse the organizer's share (exact amount) where the money already left
    // Rallia's balance, then refund the player.
    if (plan.payout_timing === 'pay_as_you_go') {
      const chargeId = plan.stripe_charge_id;
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId);
        const transferId =
          typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;
        if (transferId) {
          await stripe.transfers.createReversal(
            transferId,
            {
              amount: refundable,
              metadata: { reason: 'withdraw_refund', paymentId: plan.payment_id },
            },
            { idempotencyKey: `lt-refund-reverse-${plan.payment_id}` }
          );
        }
      }
    } else if (plan.released_transfer_id) {
      // hold mode but already released at event end — claw back the entry portion.
      await stripe.transfers.createReversal(
        plan.released_transfer_id,
        { amount: refundable, metadata: { reason: 'withdraw_refund', paymentId: plan.payment_id } },
        { idempotencyKey: `lt-refund-reverse-${plan.payment_id}` }
      );
    }

    await stripe.refunds.create(
      {
        payment_intent: pi,
        amount: refundable,
        refund_application_fee: false,
        metadata: {
          rallia_flow: 'lt_registration',
          paymentId: plan.payment_id,
          reason: 'withdraw',
        },
      },
      { idempotencyKey: `lt-refund-${plan.payment_id}` }
    );

    await admin
      .from('lt_registration_payment')
      .update({
        status: refundable >= plan.entry_cents ? 'refunded' : 'partially_refunded',
        refund_amount_cents: refundable,
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', plan.payment_id);

    return json({ withdrawn: true, refundedCents: refundable });
  } catch (e) {
    console.error('[lt-refund-registration]', e);
    return err('internal_error', 500);
  }
});
