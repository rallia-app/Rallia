-- ============================================
-- L&T payout gate — charges_enabled, not onboarding_completed
--
-- Guards migration 20260726120000. Before it, both gates tested
-- `player_stripe_account.onboarding_completed`, a legacy flag from the
-- transfers-only reimbursement flow. An organizer could carry
-- `onboarding_completed = true` with `charges_enabled = false` (exactly the
-- state of every staging account in July 2026) and publish a paid event that
-- no player could pay for: the destination charge needs card_payments on the
-- connected account, so every registration died at Stripe instead of being
-- refused up front.
--
-- Convention (shared with every other file in this dir): one transaction,
-- ROLLBACK at the end, ASSERT for every check so a regression is a hard error
-- with a non-zero psql exit. Auth is simulated via the request.jwt.claims GUC
-- that auth.uid() reads. Runs as postgres, which bypasses RLS — the SECURITY
-- DEFINER RPCs and their triggers are what's under test.
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_payout_gate_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
$$;

DO $$
DECLARE
    v_sport   uuid;
    v_org     uuid;
    v_t       tournaments;
    v_league  leagues;
    v_season  seasons;
    v_row     player_stripe_account;
    v_v       integer;
    v_msg     text;
    v_raised  boolean;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT player_id INTO v_org FROM player_sport
     WHERE sport_id = v_sport AND is_active = true ORDER BY player_id LIMIT 1;
    ASSERT v_org IS NOT NULL, 'need an active tennis player to act as organizer';

    -- ------------------------------------------------------------------
    -- 1. The invariant: onboarding_completed can never outrank charges_enabled
    -- ------------------------------------------------------------------
    INSERT INTO player_stripe_account (player_id, stripe_account_id,
                                       onboarding_completed, charges_enabled)
    VALUES (v_org, 'acct_gate_test', true, false)
    ON CONFLICT (player_id) DO UPDATE
        SET onboarding_completed = true, charges_enabled = false
    RETURNING * INTO v_row;
    ASSERT v_row.onboarding_completed = false,
        'INSERT claiming onboarding_completed=true with charges_enabled=false must be corrected to false';

    UPDATE player_stripe_account SET charges_enabled = true
     WHERE player_id = v_org RETURNING * INTO v_row;
    ASSERT v_row.onboarding_completed = true,
        'flipping charges_enabled=true must carry onboarding_completed with it';

    UPDATE player_stripe_account SET onboarding_completed = true, charges_enabled = false
     WHERE player_id = v_org RETURNING * INTO v_row;
    ASSERT v_row.onboarding_completed = false,
        'an UPDATE cannot re-open the gap either';

    -- ------------------------------------------------------------------
    -- 2. tournament_open_registration refuses a paid draft
    -- ------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'payout gate tournament', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    UPDATE tournaments SET entry_fee_cents = 5000, currency = 'CAD' WHERE id = v_t.id;

    -- charges_enabled is false (step 1 left it there), so this must be refused.
    SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
    v_raised := false;
    BEGIN
        PERFORM tournament_open_registration(v_t.id, v_v);
    EXCEPTION WHEN OTHERS THEN
        v_raised := true; v_msg := SQLERRM;
    END;
    ASSERT v_raised, 'paid tournament opened with charges_enabled=false';
    ASSERT v_msg = 'PAYOUTS_SETUP_REQUIRED',
        format('expected PAYOUTS_SETUP_REQUIRED, got %s', v_msg);

    -- Once the account can actually take a card, it opens.
    UPDATE player_stripe_account SET charges_enabled = true WHERE player_id = v_org;
    SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
    PERFORM tournament_open_registration(v_t.id, v_v);
    ASSERT (SELECT status FROM tournaments WHERE id = v_t.id) = 'registration_open',
        'paid tournament should open once charges_enabled is true';

    -- A FREE draft is never gated.
    UPDATE player_stripe_account SET charges_enabled = false WHERE player_id = v_org;
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'payout gate free tournament', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    SELECT version INTO v_v FROM tournaments WHERE id = v_t.id;
    PERFORM tournament_open_registration(v_t.id, v_v);
    ASSERT (SELECT status FROM tournaments WHERE id = v_t.id) = 'registration_open',
        'free tournament must open regardless of payout setup';

    -- ------------------------------------------------------------------
    -- 3. season_open refuses a paid draft season
    -- ------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_org);
    v_league := league_create(
        p_name => 'payout gate league', p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    v_season := season_create(
        p_league_id => v_league.id, p_name => 'paid season',
        p_start_date => current_date, p_end_date => current_date + 60,
        p_entry_fee_cents => 3000, p_fee_payer => 'player_pays',
        p_refund_policy_kind => 'none');

    v_raised := false;
    BEGIN
        PERFORM season_open(v_season.id, v_season.version);
    EXCEPTION WHEN OTHERS THEN
        v_raised := true; v_msg := SQLERRM;
    END;
    ASSERT v_raised, 'paid season opened with charges_enabled=false';
    ASSERT v_msg = 'PAYOUTS_SETUP_REQUIRED',
        format('expected PAYOUTS_SETUP_REQUIRED, got %s', v_msg);

    UPDATE player_stripe_account SET charges_enabled = true WHERE player_id = v_org;
    SELECT version INTO v_v FROM seasons WHERE id = v_season.id;
    PERFORM season_open(v_season.id, v_v);
    ASSERT (SELECT status FROM seasons WHERE id = v_season.id) = 'open',
        'paid season should open once charges_enabled is true';

    RAISE NOTICE 'lt_payout_gate_test: all assertions passed';
END $$;

ROLLBACK;
