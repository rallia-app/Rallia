/**
 * lt-refund-registration
 *
 * A paid player withdraws from a tournament. The SQL RPC
 * `tournament_request_refund` validates ownership, withdraws the registration
 * (optimistic-locked so a double-tap can't double-refund), and returns the
 * refundable ENTRY amount per the organizer's policy + cutoff. The service fee
 * is never refunded.
 *
 * v0 model: the entry sits in the organizer's connected balance (destination
 * charge). This function refunds the player with `reverse_transfer:true`, which
 * claws the exact refundable entry back from the organizer's balance to fund
 * the refund, and `refund_application_fee:false`, which keeps Rallia's fee.
 *
 * POST /lt-refund-registration   (authenticated — JWT validated internally)
 * Body:    { registrationId: string, versionWas: number }    -- tournament entry
 *      or  { seasonMemberId: string, versionWas: number }    -- league season entry
 *          (exactly one of registrationId / seasonMemberId)
 *      +   { asOrganizer: true }   -- season only: the organizer refunds and
 *          removes a member (season_refund_member) instead of the member
 *          withdrawing themselves (season_request_refund). Same 8-column plan,
 *          so everything downstream is identical.
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
  | 'not_organizer'
  | 'registration_not_found'
  | 'withdraw_not_allowed'
  | 'no_paid_registration'
  | 'enrollment_not_found'
  | 'no_paid_enrollment'
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
    case 'NOT_ORGANIZER':
      return 'not_organizer';
    case 'REGISTRATION_NOT_FOUND':
      return 'registration_not_found';
    case 'WITHDRAW_NOT_ALLOWED':
      return 'withdraw_not_allowed';
    case 'NO_PAID_REGISTRATION':
      return 'no_paid_registration';
    case 'ENROLLMENT_NOT_FOUND':
      return 'enrollment_not_found';
    case 'NO_PAID_ENROLLMENT':
      return 'no_paid_enrollment';
    case 'OPTIMISTIC_LOCK_CONFLICT':
      return 'lock_conflict';
    default:
      return 'refund_failed';
  }
}

interface RefundPlan {
  payment_id: string;
  stripe_payment_intent_id: string | null;
  entry_cents: number;
  refundable_entry_cents: number;
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

    // Exactly one of registrationId (tournament) / seasonMemberId (season).
    // All three RPCs return the same 8-column plan, so everything downstream is
    // shared. asOrganizer (season only) swaps the owner-gated withdraw for the
    // organizer-gated refund+remove.
    let registrationId: string | null = null;
    let seasonMemberId: string | null = null;
    let asOrganizer = false;
    let versionWas: number;
    try {
      const body = await req.json();
      if (body?.registrationId && typeof body.registrationId === 'string') {
        registrationId = body.registrationId;
      }
      if (body?.seasonMemberId && typeof body.seasonMemberId === 'string') {
        seasonMemberId = body.seasonMemberId;
      }
      asOrganizer = body?.asOrganizer === true;
      versionWas = body?.versionWas;
      if (!registrationId === !seasonMemberId) throw new Error();
      // asOrganizer is a season-only mode.
      if (asOrganizer && !seasonMemberId) throw new Error();
      if (typeof versionWas !== 'number') throw new Error();
    } catch {
      return err('invalid_body');
    }

    // Withdraw + compute the refundable entry (as the user; SECURITY DEFINER).
    const { data: rows, error: rpcError } = registrationId
      ? await userClient.rpc('tournament_request_refund', {
          p_registration_id: registrationId,
          p_version_was: versionWas,
        })
      : asOrganizer
        ? await userClient.rpc('season_refund_member', {
            p_season_member_id: seasonMemberId,
            p_version_was: versionWas,
          })
        : await userClient.rpc('season_request_refund', {
            p_season_member_id: seasonMemberId,
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

    // The RPC has already committed the withdrawal. If the Stripe call now
    // fails, the player is withdrawn and unrefunded with no way back: retrying
    // hits OPTIMISTIC_LOCK_CONFLICT because the version was bumped, and even
    // with the fresh version the RPC's status filter no longer matches a
    // withdrawn row. So undo the withdrawal and let them try again.
    //
    // Safe if the refund actually went through and we only lost the response:
    // the idempotency key below means the retry returns that same refund rather
    // than issuing a second one, and the retry then withdraws and marks the
    // ledger correctly.
    const rollbackWithdrawal = async () => {
      const at = new Date().toISOString();
      const { error } = registrationId
        ? await admin
            .from('tournament_registrations')
            .update({ status: 'registered', withdrawn_at: null, updated_at: at })
            .eq('id', registrationId)
            .eq('status', 'withdrawn')
        : await admin
            .from('season_members')
            .update({ status: 'enrolled', withdrawn_at: null, updated_at: at })
            .eq('id', seasonMemberId)
            .eq('status', 'withdrawn');
      if (error) {
        console.error(
          '[lt-refund-registration] CRITICAL: refund failed AND rollback failed. ' +
            'Player is withdrawn with no refund. payment_id=%s',
          plan.payment_id,
          error
        );
      }
    };

    // The entry sits in the organizer's connected balance; reverse_transfer
    // claws the exact refundable amount back to fund the refund, and
    // refund_application_fee:false keeps Rallia's service fee.
    try {
      await stripe.refunds.create(
        {
          payment_intent: pi,
          amount: refundable,
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: {
            rallia_flow: 'lt_registration',
            paymentId: plan.payment_id,
            reason: 'withdraw',
          },
        },
        { idempotencyKey: `lt-refund-${plan.payment_id}` }
      );
    } catch (e) {
      console.error('[lt-refund-registration] stripe refund failed, undoing withdrawal', e);
      await rollbackWithdrawal();
      return err('refund_failed', 502);
    }

    // The money is back with the player. If this write is lost the ledger still
    // reads 'succeeded', which makes the row a release candidate and would pay
    // the organizer for a refund they already funded, so retry before giving up
    // and make the failure loud rather than silent.
    let ledgerError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await admin
        .from('lt_registration_payment')
        .update({
          status: refundable >= plan.entry_cents ? 'refunded' : 'partially_refunded',
          refund_amount_cents: refundable,
          refunded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', plan.payment_id);
      ledgerError = error;
      if (!error) break;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    if (ledgerError) {
      console.error(
        '[lt-refund-registration] CRITICAL: refunded %d cents but could not mark the ledger. ' +
          'This row will look like a payout candidate. payment_id=%s',
        refundable,
        plan.payment_id,
        ledgerError
      );
      return err('refund_failed', 500);
    }

    return json({ withdrawn: true, refundedCents: refundable });
  } catch (e) {
    console.error('[lt-refund-registration]', e);
    return err('internal_error', 500);
  }
});
