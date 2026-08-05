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
 * Every call also reconciles player_stripe_account with the live Stripe
 * account, so a missed account.updated webhook can't strand an organizer:
 * the next tap on the payout row heals the mirror and the payout gate.
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
      .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted')
      .eq('player_id', playerId)
      .single();

    // No account yet — the caller should go through player-stripe-onboard first.
    if (!acctRow) return json({ error: 'no_account' }, 404);

    // Reconcile the mirror with Stripe before branching. The flags are normally
    // webhook-written, but a missed account.updated (endpoint gap, secret
    // mismatch, delivery failure) strands the organizer on "action required"
    // forever: re-entering a complete onboarding is a no-op that fires no new
    // event, so the mirror can never catch up on its own. Observed for real on
    // staging 2026-08-02. This is the user-tap path, so one retrieve per tap
    // makes the row self-healing and lets the branch below decide on fresh
    // truth instead of the possibly stale mirror.
    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieve(acctRow.stripe_account_id);
    } catch (err) {
      // resource_missing: the account id no longer exists at Stripe (deleted in
      // the dashboard, or a test-mode reset). Drop the dead pointer so the
      // client falls back to the onboard CTA and mints a fresh account.
      if ((err as { code?: string })?.code === 'resource_missing') {
        await admin.from('player_stripe_account').delete().eq('player_id', playerId);
        return json({ error: 'no_account' }, 404);
      }
      throw err;
    }
    if ((account as unknown as { deleted?: boolean }).deleted) {
      await admin.from('player_stripe_account').delete().eq('player_id', playerId);
      return json({ error: 'no_account' }, 404);
    }

    // Legacy accounts (court-reimbursement era) were created transfers-only.
    // Hosted onboarding never ADDS capabilities, so such an account can be
    // fully onboarded and still unable to be the on_behalf_of merchant —
    // Stripe rejects the charge with "'transfers' but without 'card_payments'".
    // Upgrade in place (preserves everything already submitted; the old
    // delete-and-recreate would throw a completed onboarding away) and put it
    // on the manual payout schedule v0 settlement relies on.
    if (account.capabilities?.card_payments == null) {
      account = await stripe.accounts.update(acctRow.stripe_account_id, {
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        settings: { payouts: { schedule: { interval: 'manual' } } },
      });
    }

    // Ready = can take CARD payments. charges_enabled alone also goes true on
    // transfers-only accounts, which is exactly the trap above.
    const chargesEnabled =
      account.charges_enabled === true && account.capabilities?.card_payments === 'active';
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;
    if (
      chargesEnabled !== (acctRow.charges_enabled === true) ||
      payoutsEnabled !== (acctRow.payouts_enabled === true) ||
      detailsSubmitted !== (acctRow.details_submitted === true)
    ) {
      // Same write shape as stripe-connect-webhook. onboarding_completed is a
      // legacy alias kept equal to charges_enabled by
      // trg_player_stripe_account_sync_onboarding, but write it anyway so the
      // two paths stay textually identical.
      const { error: syncError } = await admin
        .from('player_stripe_account')
        .update({
          onboarding_completed: chargesEnabled,
          charges_enabled: chargesEnabled,
          payouts_enabled: payoutsEnabled,
          details_submitted: detailsSubmitted,
          updated_at: new Date().toISOString(),
        })
        .eq('player_id', playerId);
      // A failed sync shouldn't block the link the user asked for; the next
      // tap (or the webhook) retries it.
      if (syncError) {
        console.error('[player-stripe-manage] flag sync failed:', syncError);
      }
    }

    // Fully onboarded → Express dashboard (bank details, payouts, balance).
    // createLoginLink throws if charges aren't enabled yet; chargesEnabled is
    // the fresh Stripe value, not the mirror.
    if (chargesEnabled) {
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
      // Match player-stripe-onboard: collect eventually_due too, so resuming an
      // incomplete account asks for identity verification in this pass rather than
      // bouncing the organizer back for another round.
      collection_options: { fields: 'eventually_due' },
    });

    return json({ url: accountLink.url, kind: 'onboarding' });
  } catch (err) {
    console.error('[player-stripe-manage]', err);
    return json({ error: 'internal_error' }, 500);
  }
});
