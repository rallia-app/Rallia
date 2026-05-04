/**
 * match-payment-mark-manual
 *
 * Lets the match host mark a participant as paid out-of-band (cash, Interac
 * email request, Venmo, prior settlement, etc.). This is the only payment
 * path for hosts in payouts_mode='manual_only', and an escape hatch for
 * 'auto' hosts when a player paid outside Stripe.
 *
 * Edge cases handled:
 *   - If the participant has a Stripe charge in flight (pending_host_transfer
 *     row with status='awaiting_onboarding'), we refund the charge to the
 *     player to avoid double-billing them. The host never sees this money;
 *     they collect it directly from the player.
 *   - If the participant's charge has already been released to the host, we
 *     do NOT auto-refund — the host has the money. The mark-manual call is
 *     ignored with a clear error.
 *
 * POST /match-payment-mark-manual  (authenticated — JWT validated internally)
 * Body:    { participantId: string }
 * Success: { ok: true; refundedCents?: number }
 * Errors:  { error: ErrorCode }
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
  | 'participant_not_found'
  | 'not_host'
  | 'already_paid_via_stripe'
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

    const callerId = user.id;

    let participantId: string;
    try {
      const body = await req.json();
      participantId = body?.participantId;
      if (!participantId || typeof participantId !== 'string') throw new Error();
    } catch {
      return err('invalid_body');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    // ---------------------------------- Load participant + match for AuthZ
    const { data: participant } = await admin
      .from('match_participant')
      .select('id, match_id, player_id, has_paid, is_host, payment_intent_id')
      .eq('id', participantId)
      .single();

    if (!participant) return err('participant_not_found', 404);

    const { data: match } = await admin
      .from('match')
      .select('id, created_by')
      .eq('id', participant.match_id)
      .single();

    if (!match || match.created_by !== callerId) return err('not_host', 403);

    // No-op if already paid AND no in-flight Stripe charge to reconcile
    if (participant.has_paid && !participant.payment_intent_id) {
      return json({ ok: true });
    }

    // ---------------------------------- Refund any in-flight Stripe charge
    let refundedCents: number | undefined;
    const { data: pending } = await admin
      .from('pending_host_transfer')
      .select('id, status, stripe_charge_id, amount_cents')
      .eq('match_participant_id', participantId)
      .maybeSingle();

    if (pending) {
      if (pending.status === 'released') {
        // Funds already on their way to the host. Marking manual would
        // double-collect — refuse and surface a clear error.
        return err('already_paid_via_stripe');
      }

      if (pending.status === 'awaiting_onboarding') {
        // Refund the charge to the player so they aren't double-billed.
        // reverse_transfer is irrelevant here (no transfer was made).
        try {
          const refund = await stripe.refunds.create(
            {
              charge: pending.stripe_charge_id,
              metadata: { reason: 'mark_manual', participantId },
            },
            { idempotencyKey: `refund-mark-manual-${pending.id}` }
          );
          refundedCents = pending.amount_cents;

          await admin
            .from('pending_host_transfer')
            .update({
              status: 'refunded',
              refunded_at: new Date().toISOString(),
              refunded_refund_id: refund.id,
            })
            .eq('id', pending.id);
        } catch (e) {
          console.error('[match-payment-mark-manual] refund failed:', e);
          return err('internal_error', 500);
        }
      }
      // 'refunded' or 'expired' rows: nothing to do; flip has_paid below.
    }

    // ---------------------------------- Flip has_paid
    if (!participant.has_paid) {
      await admin.from('match_participant').update({ has_paid: true }).eq('id', participantId);
    }

    return json({ ok: true, refundedCents });
  } catch (e) {
    console.error('[match-payment-mark-manual]', e);
    return err('internal_error', 500);
  }
});
