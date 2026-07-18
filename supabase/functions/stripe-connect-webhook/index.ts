/**
 * stripe-connect-webhook
 *
 * Receives Stripe webhook events for Connect account updates and mirrors the
 * organizer's onboarding state onto player_stripe_account. The account is the
 * settlement merchant for paid tournament registrations, so "ready" means it
 * can take card payments (charges_enabled), not merely receive transfers.
 *
 * Configure in Stripe Dashboard:
 *   Endpoint URL: https://<project>.supabase.co/functions/v1/stripe-connect-webhook
 *   Events:       account.updated
 *   Listen to:    Events on Connected accounts
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 *   STRIPE_CONNECT_WEBHOOK_SECRET   (whsec_... from Stripe Dashboard)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// No CORS headers — Stripe calls this directly, not from a browser.

Deno.serve(async req => {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
  const webhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  // Raw body is required for Stripe signature verification
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    // Deno's edge runtime uses Web Crypto (SubtleCrypto), which is async-only.
    // Must use constructEventAsync — the sync variant throws in this runtime.
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-connect-webhook] Invalid signature:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    const stripeAccountId = account.id;

    // The organizer account is the settlement merchant for on_behalf_of charges,
    // so it must be able to take card payments — charges_enabled reflects that.
    // Mirror both directions so a deauthorized account flips back to incomplete.
    const isReady = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    // Unconditional update: the granular flags can shift (e.g. payouts_enabled
    // flips while charges_enabled is unchanged), so we can't gate on
    // onboarding_completed alone the way the single-flag version did.
    const { error } = await admin
      .from('player_stripe_account')
      .update({
        onboarding_completed: isReady,
        charges_enabled: isReady,
        payouts_enabled: payoutsEnabled,
        details_submitted: detailsSubmitted,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_account_id', stripeAccountId);

    if (error) {
      console.error('[stripe-connect-webhook] Failed to update onboarding state:', error);
      // Return 500 so Stripe retries
      return new Response('DB update failed', { status: 500 });
    }

    console.log(
      `[stripe-connect-webhook] account ${stripeAccountId} charges=${isReady} payouts=${payoutsEnabled} details=${detailsSubmitted}`
    );
  }

  // Always return 200 for events we don't handle — Stripe retries non-200s
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
