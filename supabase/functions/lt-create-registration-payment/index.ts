/**
 * lt-create-registration-payment
 *
 * Opens a Stripe PaymentIntent for a paid tournament registration.
 *
 * The slot reservation + fee snapshot is done atomically in SQL by
 * `tournament_begin_paid_registration` (reserves a 'payment_pending'
 * registration and writes a 'pending' lt_registration_payment row). This
 * function then creates the PaymentIntent that matches that snapshot, using one
 * of two Stripe models depending on the event's payout_timing:
 *
 *   pay_as_you_go        → DESTINATION charge: transfer_data.destination = the
 *                          organizer's connected account, application_fee_amount
 *                          = the service fee. Stripe routes entry to the
 *                          organizer and the fee to Rallia, then pays out on a
 *                          rolling basis.
 *
 *   hold_until_event_end → SEPARATE charge (no transfer_data): funds land in
 *                          Rallia's platform balance and are transferred to the
 *                          organizer when the event finishes (Phase 3). Protects
 *                          against cancellation clawback.
 *
 * The webhook (lt-payment-webhook) finalizes the registration to 'registered'
 * on payment_intent.succeeded. Abandoned reservations are freed by the
 * lt_expire_stale_registration_payments cron.
 *
 * POST /lt-create-registration-payment   (authenticated — JWT validated internally)
 * Body:    { tournamentId: string; partnerId?: string }
 * Success: { clientSecret, paymentId, entryCents, serviceFeeCents,
 *            amountChargedCents, currency }
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
  | 'tournament_not_found'
  | 'tournament_reg_closed'
  | 'tournament_not_paid'
  | 'tournament_full'
  | 'already_registered'
  | 'paid_mode_unsupported'
  | 'organizer_not_ready'
  | 'registration_failed'
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

/** Map a Postgres RAISE message from the begin RPC to a client error code. */
function mapRpcError(message: string | undefined): ErrorCode {
  switch (message) {
    case 'TOURNAMENT_NOT_FOUND':
      return 'tournament_not_found';
    case 'TOURNAMENT_REG_CLOSED':
      return 'tournament_reg_closed';
    case 'TOURNAMENT_NOT_PAID':
      return 'tournament_not_paid';
    case 'TOURNAMENT_FULL':
      return 'tournament_full';
    case 'ALREADY_REGISTERED':
      return 'already_registered';
    case 'PAID_REG_MODE_UNSUPPORTED':
      return 'paid_mode_unsupported';
    default:
      return 'registration_failed';
  }
}

interface BeginRow {
  payment_id: string;
  registration_id: string;
  entry_cents: number;
  service_fee_cents: number;
  amount_charged_cents: number;
  organizer_amount_cents: number;
  fee_payer: string;
  payout_timing: string;
  currency: string;
  organizer_id: string;
  organizer_stripe_account_id: string | null;
  organizer_onboarded: boolean;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---------------------------------------------------------------- auth
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

    // ---------------------------------------------------------------- body
    let tournamentId: string;
    let partnerId: string | null = null;
    try {
      const body = await req.json();
      tournamentId = body?.tournamentId;
      if (!tournamentId || typeof tournamentId !== 'string') throw new Error();
      if (body?.partnerId && typeof body.partnerId === 'string') partnerId = body.partnerId;
    } catch {
      return err('invalid_body');
    }

    // ------------------------------------- reserve slot + snapshot fee (as user)
    // SECURITY DEFINER RPC resolves auth.uid() from the forwarded JWT.
    const { data: rows, error: rpcError } = await userClient.rpc(
      'tournament_begin_paid_registration',
      { p_tournament_id: tournamentId, p_partner_user_id: partnerId }
    );
    if (rpcError) {
      return err(mapRpcError(rpcError.message), 400);
    }
    const reg = (Array.isArray(rows) ? rows[0] : rows) as BeginRow | undefined;
    if (!reg) return err('registration_failed', 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    const currency = (reg.currency || 'CAD').toLowerCase();
    const metadata: Record<string, string> = {
      rallia_flow: 'lt_registration',
      paymentId: reg.payment_id,
      registrationId: reg.registration_id,
      tournamentId,
      payerUserId: user.id,
      organizerId: reg.organizer_id,
      entryCents: String(reg.entry_cents),
      serviceFeeCents: String(reg.service_fee_cents),
      organizerAmountCents: String(reg.organizer_amount_cents),
      feePayer: reg.fee_payer,
      payoutTiming: reg.payout_timing,
    };

    const params: Stripe.PaymentIntentCreateParams = {
      amount: reg.amount_charged_cents,
      currency,
      automatic_payment_methods: { enabled: true },
      description: 'Rallia — tournament registration',
      metadata,
    };

    if (reg.payout_timing === 'pay_as_you_go') {
      // Destination charge: organizer must be ready to receive (publish gate
      // guarantees this, but guard defensively in case they deauthorized).
      if (!reg.organizer_onboarded || !reg.organizer_stripe_account_id) {
        // Roll back the reservation we just made so the slot frees immediately.
        await admin
          .from('lt_registration_payment')
          .update({ status: 'cancelled' })
          .eq('id', reg.payment_id);
        await admin
          .from('tournament_registrations')
          .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
          .eq('id', reg.registration_id)
          .eq('status', 'payment_pending');
        return err('organizer_not_ready', 409);
      }
      params.transfer_data = { destination: reg.organizer_stripe_account_id };
      params.application_fee_amount = reg.service_fee_cents;
    }
    // hold_until_event_end: plain platform charge; transfer happens at event end.

    const paymentIntent = await stripe.paymentIntents.create(params, {
      idempotencyKey: `lt-reg-${reg.payment_id}`,
    });

    await admin
      .from('lt_registration_payment')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', reg.payment_id);

    return json({
      clientSecret: paymentIntent.client_secret,
      paymentId: reg.payment_id,
      entryCents: reg.entry_cents,
      serviceFeeCents: reg.service_fee_cents,
      amountChargedCents: reg.amount_charged_cents,
      currency: reg.currency,
    });
  } catch (e) {
    console.error('[lt-create-registration-payment]', e);
    return err('internal_error', 500);
  }
});
