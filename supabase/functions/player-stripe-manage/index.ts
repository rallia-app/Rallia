/**
 * player-stripe-manage
 *
 * Post-onboarding management entry point for a tournament/league ORGANIZER's
 * payout account. Unlike player-stripe-onboard (which sets the account up), this
 * returns the right link for an account that already exists:
 *
 *   - Fully onboarded (charges enabled) → a Stripe Express dashboard LOGIN link,
 *     where the organizer can update bank details, view payouts, and see their
 *     balance. Express accounts have no standalone login, so this is the only
 *     way in.
 *   - Onboarding incomplete → a fresh account_onboarding link to resume the
 *     flow (createLoginLink would throw before charges are enabled).
 *
 * POST /player-stripe-manage  (authenticated — JWT validated internally)
 * Response: { url: string, kind: 'dashboard' | 'onboarding' }
 *           404 { error: 'no_account' } when the caller has never onboarded.
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_auth' }, 401);

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
    if (authError || !user) return json({ error: 'invalid_auth' }, 401);

    const playerId = user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    const { data: acctRow } = await admin
      .from('player_stripe_account')
      .select('stripe_account_id, charges_enabled')
      .eq('player_id', playerId)
      .single();

    // No account yet — the caller should go through player-stripe-onboard first.
    if (!acctRow) return json({ error: 'no_account' }, 404);

    // Fully onboarded → Express dashboard (bank details, payouts, balance).
    // createLoginLink throws if charges aren't enabled yet, so gate on the
    // webhook-mirrored flag rather than assuming.
    if (acctRow.charges_enabled) {
      const loginLink = await stripe.accounts.createLoginLink(acctRow.stripe_account_id);
      return json({ url: loginLink.url, kind: 'dashboard' });
    }

    // Onboarding never finished → resume it. account_onboarding is the correct
    // flow for an incomplete Express account (account_update is for accounts
    // that are already enabled but need to edit collected info).
    const functionUrl = supabaseUrl.replace('/rest/v1', '') + '/functions/v1/player-stripe-manage';

    const accountLink = await stripe.accountLinks.create({
      account: acctRow.stripe_account_id,
      type: 'account_onboarding',
      return_url:
        Deno.env.get('STRIPE_CONNECT_RETURN_URL') ?? 'https://rallia.app/stripe-connect-return',
      refresh_url: `${functionUrl}?refresh=1`,
    });

    return json({ url: accountLink.url, kind: 'onboarding' });
  } catch (err) {
    console.error('[player-stripe-manage]', err);
    return json({ error: 'internal_error' }, 500);
  }
});
