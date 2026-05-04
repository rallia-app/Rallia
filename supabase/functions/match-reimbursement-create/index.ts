/**
 * match-reimbursement-create
 *
 * Creates a Stripe PaymentIntent for one participant's share of the court cost.
 *
 * Architecture: Separate charges and transfers (NOT destination charges).
 *   - Rallia is the merchant of record on the charge.
 *   - Funds land in Rallia's Stripe platform balance.
 *   - When the host has completed Stripe Connect onboarding, the webhook
 *     releases the funds via stripe.transfers.create.
 *   - Otherwise, the webhook inserts a pending_host_transfer row and prompts
 *     the host to onboard ("$X ready to receive — finish setup").
 *
 * This means a player can pay BEFORE the host has done Stripe onboarding —
 * which dramatically reduces friction (host onboarding happens with money
 * visible, not speculatively).
 *
 * If the host has chosen payouts_mode='manual_only', this function refuses
 * to create a PaymentIntent — the host has opted out of payment processing
 * and players must pay out-of-band (mark_paid_manual).
 *
 * POST /match-reimbursement-create  (authenticated — JWT validated internally)
 * Body:    { matchId: string }
 * Success: { clientSecret: string; amountCents: number; currency: string }
 * Errors:  { error: ErrorCode }
 *
 * ErrorCode:
 *   - missing_auth | invalid_auth     : caller authentication
 *   - invalid_body                    : matchId missing/wrong type
 *   - invalid_match                   : match doesn't exist or isn't eligible
 *   - not_participant                 : caller isn't a joined non-host participant
 *   - already_paid                    : caller already paid
 *   - host_manual_only                : host opted out of Stripe — pay out-of-band
 *   - internal_error                  : everything else
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
  | 'invalid_match'
  | 'not_participant'
  | 'already_paid'
  | 'host_manual_only'
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

    const playerId = user.id;

    // ---------------------------------------------------------------- body
    let matchId: string;
    try {
      const body = await req.json();
      matchId = body?.matchId;
      if (!matchId || typeof matchId !== 'string') throw new Error();
    } catch {
      return err('invalid_body');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    // --------------------------------------------------------------- match
    const { data: match } = await admin
      .from('match')
      .select('id, estimated_cost, cost_split_type, is_court_free, created_by, cancelled_at')
      .eq('id', matchId)
      .single();

    if (
      !match ||
      match.cancelled_at ||
      match.is_court_free ||
      match.cost_split_type !== 'split_equal' ||
      !match.estimated_cost ||
      match.estimated_cost <= 0
    ) {
      return err('invalid_match');
    }

    // ----------------------------------------- verify caller is a participant
    const { data: participant } = await admin
      .from('match_participant')
      .select('id, has_paid, is_host')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .eq('status', 'joined')
      .single();

    if (!participant || participant.is_host) return err('not_participant');
    if (participant.has_paid) return err('already_paid');

    // -------------------------------- host opted out of Stripe (manual only)
    const { data: host } = await admin
      .from('player')
      .select('payouts_mode')
      .eq('id', match.created_by)
      .single();

    if (host?.payouts_mode === 'manual_only') {
      return err('host_manual_only');
    }

    // ------------------------------------ deterministic split among non-hosts
    // Compute splits across all joined non-host participants (ordered by
    // created_at) so that residual cents land on the earliest joiners
    // deterministically. This caller's amount is the entry at their index.
    const { data: orderedPayers } = await admin
      .from('match_participant')
      .select('id, player_id')
      .eq('match_id', matchId)
      .eq('status', 'joined')
      .eq('is_host', false)
      .order('created_at', { ascending: true });

    const payerCount = orderedPayers?.length ?? 0;
    if (payerCount < 1) return err('invalid_match');

    const totalCents = Math.round(match.estimated_cost * 100);
    const base = Math.floor(totalCents / payerCount);
    const residual = totalCents - base * payerCount;

    const myIndex = orderedPayers.findIndex(p => p.player_id === playerId);
    if (myIndex === -1) return err('not_participant');

    const amountCents = base + (myIndex < residual ? 1 : 0);
    if (amountCents <= 0) return err('invalid_match');

    // ---------------------------------------------------- create PaymentIntent
    // Separate charges and transfers: NO transfer_data on the PaymentIntent.
    // Rallia is the merchant; the actual payout to the host happens later in
    // stripe-match-webhook (via stripe.transfers.create when host is ready,
    // or via a pending_host_transfer row otherwise).
    //
    // Idempotency: keyed by (matchId, playerId) so duplicate calls return
    // the same PI. The DB write below fills in payment_intent_id which the
    // webhook reads for reconciliation.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'cad',
        automatic_payment_methods: { enabled: true },
        description: 'Rallia — court reimbursement',
        metadata: {
          // Used by stripe-match-webhook to find the participant and host
          matchId,
          playerId,
          hostPlayerId: match.created_by,
          participantId: participant.id,
          rallia_flow: 'match_reimbursement',
        },
      },
      { idempotencyKey: `reimburse-${matchId}-${playerId}` }
    );

    // ------------------------- persist PI id for webhook reconciliation
    // The column is still named `payment_intent_id` (legacy from the
    // destination-charge era). We continue to use it as the external
    // payment reference; no rename required.
    await admin
      .from('match_participant')
      .update({ payment_intent_id: paymentIntent.id })
      .eq('id', participant.id);

    return json({
      clientSecret: paymentIntent.client_secret,
      amountCents,
      currency: 'cad',
    });
  } catch (err_) {
    console.error('[match-reimbursement-create]', err_);
    return err('internal_error', 500);
  }
});
