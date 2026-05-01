/**
 * player-stripe-onboard
 *
 * Creates (or retrieves) the player's Stripe Express connected account and
 * returns a hosted onboarding URL.  The mobile app opens the URL in the
 * system browser (Linking.openURL); Stripe redirects back via Universal Link
 * to https://rallia.app/stripe-connect-return when the user finishes.
 *
 * POST /player-stripe-onboard  (authenticated — JWT validated internally)
 * Response: { url: string }
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ------------------------------------------------------------------ auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_auth' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    // Authenticated client — resolves the player's identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'invalid_auth' }, 401);

    const playerId = user.id;

    // Service-role client — used for privileged writes
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    // -------------------------------------------- get or create Stripe account
    const { data: existing } = await admin
      .from('player_stripe_account')
      .select('stripe_account_id, onboarding_completed')
      .eq('player_id', playerId)
      .single();

    let stripeAccountId: string;

    if (existing) {
      stripeAccountId = existing.stripe_account_id;
    } else {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;

      const { error: insertError } = await admin
        .from('player_stripe_account')
        .insert({ player_id: playerId, stripe_account_id: stripeAccountId });

      if (insertError) {
        // Clean up the Stripe account we just created before failing
        await stripe.accounts.del(stripeAccountId).catch(() => {});
        throw new Error(`Failed to persist stripe account: ${insertError.message}`);
      }
    }

    // ------------------------------------------------- generate onboarding link
    const functionUrl =
      Deno.env.get('SUPABASE_URL')!.replace('/rest/v1', '') + '/functions/v1/player-stripe-onboard';

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: 'account_onboarding',
      return_url: 'https://rallia.app/stripe-connect-return',
      refresh_url: `${functionUrl}?refresh=1`,
    });

    return json({ url: accountLink.url });
  } catch (err) {
    console.error('[player-stripe-onboard]', err);
    return json({ error: 'internal_error' }, 500);
  }
});
