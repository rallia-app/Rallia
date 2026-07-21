/**
 * lt-create-registration-payment
 *
 * Opens a Stripe PaymentIntent for a paid tournament registration.
 *
 * The slot reservation + fee snapshot is done atomically in SQL by
 * `tournament_begin_paid_registration` (reserves a 'payment_pending'
 * registration and writes a 'pending' lt_registration_payment row). This
 * function then creates the PaymentIntent that matches that snapshot.
 *
 * v0 payment model (one shape for every event): a DESTINATION charge with
 * on_behalf_of = the organizer's connected account and application_fee_amount =
 * the service fee. The entry settles into the ORGANIZER's connected balance
 * (held there via their manual payout schedule until the event ends, then paid
 * out by lt-settle-event-payments); the fee settles to Rallia. Rallia never
 * holds the entry. Refunds reverse the entry back from the organizer's balance
 * (reverse_transfer) and keep the fee. Requires the organizer's connected
 * account to carry the card_payments capability.
 *
 * The webhook (lt-payment-webhook) finalizes the registration to 'registered'
 * on payment_intent.succeeded. Abandoned reservations are freed by the
 * lt_expire_stale_registration_payments cron.
 *
 * POST /lt-create-registration-payment   (authenticated — JWT validated internally)
 * Body:    { tournamentId: string; partnerId?: string }   -- tournament entry
 *      or  { seasonId: string }                           -- league season entry
 *          (exactly one of tournamentId / seasonId)
 * Success: { clientSecret, paymentId, entryCents, serviceFeeCents,
 *            feeTaxCents, amountChargedCents, currency }
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
  | 'registration_removed'
  | 'rating_required'
  | 'rating_too_low'
  | 'partner_required'
  | 'partner_not_allowed'
  | 'partner_invalid'
  | 'partner_sport_mismatch'
  | 'partner_already_registered'
  | 'partner_rating_required'
  | 'partner_rating_too_low'
  | 'season_not_found'
  | 'season_not_open'
  | 'season_not_paid'
  | 'not_league_member'
  | 'already_enrolled'
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
    // Entry rules the paid path now enforces alongside tournament_register.
    // Passed through rather than collapsed into registration_failed so the
    // player is told why they were refused, before any charge.
    case 'REGISTRATION_REMOVED':
      return 'registration_removed';
    case 'RATING_REQUIRED':
      return 'rating_required';
    case 'RATING_TOO_LOW':
      return 'rating_too_low';
    case 'PARTNER_REQUIRED':
      return 'partner_required';
    case 'PARTNER_NOT_ALLOWED':
      return 'partner_not_allowed';
    case 'PARTNER_INVALID':
      return 'partner_invalid';
    case 'PARTNER_SPORT_MISMATCH':
      return 'partner_sport_mismatch';
    case 'PARTNER_ALREADY_REGISTERED':
      return 'partner_already_registered';
    case 'PARTNER_RATING_REQUIRED':
      return 'partner_rating_required';
    case 'PARTNER_RATING_TOO_LOW':
      return 'partner_rating_too_low';
    case 'SEASON_NOT_FOUND':
      return 'season_not_found';
    case 'SEASON_NOT_OPEN':
      return 'season_not_open';
    case 'SEASON_NOT_PAID':
      return 'season_not_paid';
    case 'NOT_LEAGUE_MEMBER':
      return 'not_league_member';
    case 'ALREADY_ENROLLED':
      return 'already_enrolled';
    default:
      return 'registration_failed';
  }
}

interface BeginRow {
  payment_id: string;
  /** Tournament leg only. */
  registration_id?: string;
  /** Season leg only. */
  season_user_id?: string;
  entry_cents: number;
  service_fee_cents: number;
  fee_tax_cents: number;
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
    // Exactly one of tournamentId / seasonId. Both legs are identical from the
    // begin-RPC's return onward, so only the reservation call and the rollback
    // target differ.
    let tournamentId: string | null = null;
    let seasonId: string | null = null;
    let partnerId: string | null = null;
    try {
      const body = await req.json();
      if (body?.tournamentId && typeof body.tournamentId === 'string') {
        tournamentId = body.tournamentId;
      }
      if (body?.seasonId && typeof body.seasonId === 'string') {
        seasonId = body.seasonId;
      }
      if (!tournamentId === !seasonId) throw new Error();
      if (body?.partnerId && typeof body.partnerId === 'string') partnerId = body.partnerId;
    } catch {
      return err('invalid_body');
    }

    // ------------------------------------- reserve slot + snapshot fee (as user)
    // SECURITY DEFINER RPC resolves auth.uid() from the forwarded JWT.
    const { data: rows, error: rpcError } = tournamentId
      ? await userClient.rpc('tournament_begin_paid_registration', {
          p_tournament_id: tournamentId,
          p_partner_user_id: partnerId,
        })
      : await userClient.rpc('season_begin_paid_enrollment', { p_season_id: seasonId });
    if (rpcError) {
      return err(mapRpcError(rpcError.message), 400);
    }
    const reg = (Array.isArray(rows) ? rows[0] : rows) as BeginRow | undefined;
    if (!reg) return err('registration_failed', 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    const currency = (reg.currency || 'CAD').toLowerCase();
    // rallia_flow stays 'lt_registration' for both legs — the webhook keys off it
    // to recognise our intents, then resolves the leg from the ledger row itself.
    const metadata: Record<string, string> = {
      rallia_flow: 'lt_registration',
      paymentId: reg.payment_id,
      ...(tournamentId
        ? { registrationId: String(reg.registration_id), tournamentId }
        : { seasonUserId: String(reg.season_user_id), seasonId: String(seasonId) }),
      payerUserId: user.id,
      organizerId: reg.organizer_id,
      entryCents: String(reg.entry_cents),
      serviceFeeCents: String(reg.service_fee_cents),
      feeTaxCents: String(reg.fee_tax_cents),
      organizerAmountCents: String(reg.organizer_amount_cents),
      feePayer: reg.fee_payer,
      payoutTiming: reg.payout_timing,
    };

    // v0: always a destination charge on behalf of the organizer. The entry
    // settles into the organizer's connected balance (held there by their manual
    // payout schedule until the event ends), the service fee into Rallia's —
    // Rallia never holds the entry. The organizer must be fully onboarded: the
    // publish gate guarantees it, but guard defensively in case they
    // deauthorized between opening registration and this charge.
    if (!reg.organizer_onboarded || !reg.organizer_stripe_account_id) {
      // Roll back the reservation we just made so the slot frees immediately.
      await admin
        .from('lt_registration_payment')
        .update({ status: 'cancelled' })
        .eq('id', reg.payment_id);
      if (tournamentId) {
        await admin
          .from('tournament_registrations')
          .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
          .eq('id', reg.registration_id)
          .eq('status', 'payment_pending');
      } else {
        await admin
          .from('season_members')
          .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
          .eq('id', reg.season_user_id)
          .eq('status', 'payment_pending');
      }
      return err('organizer_not_ready', 409);
    }

    // Kill any PaymentIntent we've already given up on for this payer. The begin
    // RPC supersedes a previous attempt by cancelling its ledger row, and the
    // reaper cancels expired ones, but neither can reach Stripe — so the old
    // intent stayed confirmable. If the player still had that sheet open, both
    // could be confirmed and they'd be charged twice for one slot.
    const { data: stale } = await admin
      .from('lt_registration_payment')
      .select('id, stripe_payment_intent_id')
      .eq('payer_user_id', user.id)
      .eq('status', 'cancelled')
      .not('stripe_payment_intent_id', 'is', null)
      .neq('id', reg.payment_id)
      .eq(
        tournamentId ? 'tournament_registration_id' : 'season_user_id',
        tournamentId ? reg.registration_id : reg.season_user_id
      );
    for (const s of stale ?? []) {
      try {
        await stripe.paymentIntents.cancel(s.stripe_payment_intent_id);
      } catch (e) {
        // Already cancelled, already succeeded, or gone. A succeeded one is the
        // orphan case the webhook logs; nothing to do from here.
        console.warn('[lt-create-registration-payment] stale PI cancel skipped', s.id, e);
      }
    }

    const params: Stripe.PaymentIntentCreateParams = {
      amount: reg.amount_charged_cents,
      currency,
      automatic_payment_methods: { enabled: true },
      description: tournamentId ? 'Rallia — tournament registration' : 'Rallia — league season',
      on_behalf_of: reg.organizer_stripe_account_id,
      transfer_data: { destination: reg.organizer_stripe_account_id },
      // Rallia's cut = service fee + GST/QST on it (Rallia remits the tax).
      application_fee_amount: reg.service_fee_cents + reg.fee_tax_cents,
      metadata,
    };

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
      feeTaxCents: reg.fee_tax_cents,
      amountChargedCents: reg.amount_charged_cents,
      currency: reg.currency,
    });
  } catch (e) {
    console.error('[lt-create-registration-payment]', e);
    return err('internal_error', 500);
  }
});
