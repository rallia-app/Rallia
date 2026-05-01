/**
 * match-reimbursement-create
 *
 * Creates a Stripe PaymentIntent (destination charge) for one participant's
 * share of the court cost and returns the client secret so the mobile app
 * can present the Payment Sheet (which surfaces Apple Pay automatically on iOS).
 *
 * POST /match-reimbursement-create  (authenticated — JWT validated internally)
 * Body:    { matchId: string }
 * Success: { clientSecret: string; amountCents: number; currency: string }
 * Errors:  { error: ErrorCode }
 *
 * ErrorCode: 'invalid_match' | 'not_participant' | 'already_paid' | 'host_not_connected'
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
  | 'host_not_connected'
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
    // ------------------------------------------------------------------ auth
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

    // ------------------------------------------------------------------ body
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

    // ----------------------------------------------------------------- match
    const { data: match } = await admin
      .from('match')
      .select('id, estimated_cost, cost_split_type, is_court_free, created_by')
      .eq('id', matchId)
      .single();

    if (
      !match ||
      match.is_court_free ||
      match.cost_split_type !== 'split_equal' ||
      !match.estimated_cost ||
      match.estimated_cost <= 0
    ) {
      return err('invalid_match');
    }

    // ------------------------------------------- verify caller is a participant
    const { data: participant } = await admin
      .from('match_participant')
      .select('id, has_paid')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .eq('status', 'joined')
      .neq('is_host', true)
      .single();

    if (!participant) return err('not_participant');
    if (participant.has_paid) return err('already_paid');

    // --------------------------------------------- count joined participants
    const { count: joinedCount } = await admin
      .from('match_participant')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
      .eq('status', 'joined');

    const totalPlayers = joinedCount ?? 2;
    const amountCents = Math.ceil((match.estimated_cost / totalPlayers) * 100);

    // -------------------------------------------- host must have Stripe set up
    const { data: hostStripe } = await admin
      .from('player_stripe_account')
      .select('stripe_account_id, onboarding_completed')
      .eq('player_id', match.created_by)
      .single();

    if (!hostStripe?.onboarding_completed) return err('host_not_connected');

    // ---------------------------------------------------- create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'cad',
        automatic_payment_methods: { enabled: true },
        application_fee_amount: 0, // Rallia platform fee — adjust later
        transfer_data: { destination: hostStripe.stripe_account_id },
        metadata: { matchId, playerId },
      },
      { idempotencyKey: `reimburse-${matchId}-${playerId}` }
    );

    // ---------------------------------- persist PI id for webhook reconciliation
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
