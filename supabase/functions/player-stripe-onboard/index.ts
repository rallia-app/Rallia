/**
 * player-stripe-onboard
 *
 * Creates (or retrieves) the player's Stripe Express connected account and
 * returns a hosted onboarding URL.  The mobile app opens the URL in the
 * system browser (Linking.openURL); Stripe redirects back via Universal Link
 * to https://rallia.app/stripe-connect-return when the user finishes.
 *
 * Key design decisions for minimal onboarding friction:
 *   - business_type: 'individual'  → skips "What type of business?" screen
 *   - Only 'transfers' capability  → host accounts receive money, they don't
 *     process cards (the platform does), so lighter KYC requirements
 *   - Pre-fill name, email, DOB, address from Rallia profile/player tables
 *     so Stripe won't re-ask for information we already have
 *   - MCC 7941 (Sports Clubs/Fields) for accurate risk classification
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

/**
 * Parse a birth_date string (YYYY-MM-DD) into Stripe's { day, month, year }
 * format. Returns undefined if the string is missing or malformed.
 */
function parseDob(birthDate: string | null | undefined) {
  if (!birthDate) return undefined;
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return { year: y, month: m, day: d };
}

/**
 * Map a Canadian province code (e.g. "QC") to its full Stripe-expected name.
 * Stripe's Express onboarding for Canada uses the full province/territory name
 * in the address.state field.
 */
const CA_PROVINCE_MAP: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

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

    let stripeAccountId: string | undefined;

    if (existing) {
      if (existing.onboarding_completed) {
        // Already fully onboarded — just reuse it
        stripeAccountId = existing.stripe_account_id;
      } else {
        // Account exists but onboarding isn't done yet — check if it was
        // created by an older version of this function (missing business_type,
        // wrong capabilities). If so, delete it and start fresh so the user
        // gets the streamlined individual onboarding flow.
        const acct = await stripe.accounts.retrieve(existing.stripe_account_id);
        if (acct.business_type !== 'individual') {
          await stripe.accounts.del(existing.stripe_account_id).catch(() => {});
          await admin.from('player_stripe_account').delete().eq('player_id', playerId);
          // stripeAccountId stays undefined → falls through to create below
        } else {
          stripeAccountId = existing.stripe_account_id;
        }
      }
    }

    if (!stripeAccountId) {
      // ---- Fetch profile + player data to pre-fill Stripe onboarding ----
      // Pre-filled fields are skipped by Stripe's hosted onboarding, which
      // dramatically shortens the flow for the user.
      const [{ data: profile }, { data: player }] = await Promise.all([
        admin
          .from('profile')
          .select('first_name, last_name, email, birth_date, phone')
          .eq('id', playerId)
          .single(),
        admin
          .from('player')
          .select('address, city, province, postal_code')
          .eq('id', playerId)
          .single(),
      ]);

      // Build the individual object with whatever data we have
      const individual: Stripe.AccountCreateParams.Individual = {};

      if (profile?.first_name) individual.first_name = profile.first_name;
      if (profile?.last_name) individual.last_name = profile.last_name;
      if (profile?.email) individual.email = profile.email;
      if (profile?.phone) individual.phone = profile.phone;

      const dob = parseDob(profile?.birth_date);
      if (dob) individual.dob = dob;

      // Build address from player table fields
      if (player?.address || player?.city || player?.province || player?.postal_code) {
        individual.address = {
          country: 'CA',
          ...(player.address && { line1: player.address }),
          ...(player.city && { city: player.city }),
          ...(player.province && {
            state: CA_PROVINCE_MAP[player.province] ?? player.province,
          }),
          ...(player.postal_code && { postal_code: player.postal_code }),
        };
      }

      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        business_type: 'individual',
        individual,
        capabilities: {
          transfers: { requested: true },
        },
        business_profile: {
          mcc: '7941', // Sports Clubs/Fields
          product_description: 'Receiving court cost reimbursements from co-players',
        },
        metadata: {
          player_id: playerId,
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
      return_url:
        Deno.env.get('STRIPE_CONNECT_RETURN_URL') ?? 'https://rallia.app/stripe-connect-return',
      refresh_url: `${functionUrl}?refresh=1`,
    });

    return json({ url: accountLink.url });
  } catch (err) {
    console.error('[player-stripe-onboard]', err);
    return json({ error: 'internal_error' }, 500);
  }
});
