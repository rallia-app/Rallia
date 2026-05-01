/**
 * stripe-match-webhook
 *
 * Receives Stripe webhook events for match reimbursement payments and marks
 * the participant as paid in the database.
 *
 * Configure in Stripe Dashboard:
 *   Endpoint URL: https://<project>.supabase.co/functions/v1/stripe-match-webhook
 *   Events:       payment_intent.succeeded
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 *   STRIPE_MATCH_WEBHOOK_SECRET   (whsec_... from Stripe Dashboard)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// No CORS headers — Stripe calls this directly, not from a browser.

Deno.serve(async req => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
  const webhookSecret = Deno.env.get('STRIPE_MATCH_WEBHOOK_SECRET')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  // Raw body is required for Stripe signature verification
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-match-webhook] Invalid signature:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const { matchId, playerId } = pi.metadata ?? {};

    if (matchId && playerId) {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const { error } = await admin
        .from('match_participant')
        .update({ has_paid: true })
        .eq('match_id', matchId)
        .eq('player_id', playerId);

      if (error) {
        console.error('[stripe-match-webhook] Failed to mark participant as paid:', error);
        // Return 500 so Stripe retries
        return new Response('DB update failed', { status: 500 });
      }
    }
  }

  // Always return 200 for events we don't handle — Stripe retries non-200s
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
