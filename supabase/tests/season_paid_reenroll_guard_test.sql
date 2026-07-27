-- ============================================
-- Season paid enrollment — removed-member re-entry guard (20260722100000)
--
-- Regression for the hole where an organizer-removed ('disqualified') season
-- member could buy their way back in: season_begin_paid_enrollment only
-- refused 'enrolled' rows, so the removed member fell through to the reuse
-- branch, went back to payment_pending, paid, and the webhook flip to
-- 'enrolled' passed tg_season_member_requires_payment because their original
-- (about-to-be-refunded) succeeded payment still resolved for
-- (season_id, user_id). Pre-fix, test 1 here fails.
--
-- Convention (shared with every other file in this dir): one transaction,
-- ROLLBACK at the end, ASSERT for every check so a regression is a hard error
-- with a non-zero psql exit. Auth is simulated via the request.jwt.claims GUC
-- that auth.uid() reads. Runs as postgres, which bypasses RLS — the SECURITY
-- DEFINER RPCs and their triggers are what's under test.
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/season_paid_reenroll_guard_test.sql
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helpers (mirrors of tournament_paid_registration_security_test.sql's).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_player(p_player uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_player::text)::text, true);
$$;

-- Paid open season with players[2..] as active league members.
CREATE OR REPLACE FUNCTION pg_temp.mk_paid_season(
    p_name        text,
    OUT o_org     uuid,
    OUT o_players uuid[],
    OUT o_sid     uuid
)
LANGUAGE plpgsql AS $$
DECLARE v_sport uuid; v_league leagues; v_season seasons; i integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id) ORDER BY player_id LIMIT 4) s;
    ASSERT array_length(o_players, 1) = 4, 'need 4 active tennis players';
    o_org := o_players[1];

    PERFORM pg_temp.as_player(o_org);
    SELECT * INTO v_league FROM league_create(
        p_name => p_name, p_sport_id => v_sport, p_join_mode => 'open');
    FOR i IN 2..4 LOOP
        PERFORM pg_temp.as_player(o_players[i]);
        PERFORM league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_player(o_org);
    SELECT * INTO v_season FROM season_create(
        p_league_id => v_league.id, p_name => 'S1',
        p_start_date => current_date, p_end_date => current_date + 90);
    UPDATE seasons SET entry_fee_cents = 5000, currency = 'CAD', fee_payer = 'player_pays'
     WHERE id = v_season.id;

    INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
    VALUES (o_org, 'acct_test_' || left(o_org::text, 8), true)
    ON CONFLICT (player_id) DO UPDATE SET charges_enabled = true;

    SELECT version INTO v_season.version FROM seasons WHERE id = v_season.id;
    SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);
    o_sid := v_season.id;
END $$;

-- Reserve a paid slot as a given player; returns the season_members id.
CREATE OR REPLACE FUNCTION pg_temp.reserve(p_sid uuid, p_player uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_member uuid;
BEGIN
    PERFORM pg_temp.as_player(p_player);
    SELECT season_user_id INTO v_member FROM season_begin_paid_enrollment(p_sid);
    RETURN v_member;
END $$;

-- Simulate the Stripe webhook: ledger -> succeeded, then finalize the member.
CREATE OR REPLACE FUNCTION pg_temp.mark_paid(p_member uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_charge_id = 'ch_' || left(p_member::text, 8), updated_at = now()
     WHERE season_user_id = p_member AND status = 'pending';
    UPDATE season_members
       SET status = 'enrolled', updated_at = now()
     WHERE id = p_member AND status = 'payment_pending';
$$;

-- ==========================================================================
-- 1. An organizer-removed member cannot pay their way back in.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_member uuid; v_v int;
    v_ok boolean; v_st text; v_pending int;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_paid_season('Sec R1 Reenroll League');
    v_member := pg_temp.reserve(v_sid, v_players[2]);
    PERFORM pg_temp.mark_paid(v_member);
    SELECT status INTO v_st FROM season_members WHERE id = v_member;
    ASSERT v_st = 'enrolled', '1: paid webhook finalize must reach enrolled, got ' || v_st;

    -- organizer removes them: involuntary exit, refund queued for the cron.
    PERFORM pg_temp.as_player(v_org);
    SELECT version INTO v_v FROM season_members WHERE id = v_member;
    PERFORM season_remove_member(v_member, v_v);
    SELECT status INTO v_st FROM season_members WHERE id = v_member;
    ASSERT v_st = 'disqualified', '1: removal must mark disqualified, got ' || v_st;

    -- the removed member tries to buy back in. Pre-fix this succeeded: the row
    -- went back to payment_pending and their old succeeded payment satisfied
    -- the enrollment gate.
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM season_begin_paid_enrollment(v_sid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ENROLLMENT_REMOVED'); END;
    ASSERT v_ok, '1: removed member re-enrolling must raise ENROLLMENT_REMOVED';

    SELECT status INTO v_st FROM season_members WHERE id = v_member;
    ASSERT v_st = 'disqualified', '1: row must stay disqualified, got ' || v_st;
    SELECT count(*) INTO v_pending FROM lt_registration_payment
     WHERE season_user_id = v_member AND status = 'pending';
    ASSERT v_pending = 0, '1: refusal must not open a new pending payment';

    -- their original entry is still queued for refund, untouched by the attempt.
    ASSERT EXISTS (SELECT 1 FROM lt_cancel_refund_candidates() c
                    JOIN lt_registration_payment p ON p.id = c.payment_id
                   WHERE p.season_user_id = v_member),
        '1: removed member''s entry must remain a refund candidate';

    RAISE NOTICE 'PASS 1: removed member cannot pay back in';
END $$;

-- ==========================================================================
-- 2. Positive control: the reuse branch still works for a voluntary exit —
--    a withdrawn (reaper/refund) member may start a fresh paid enrollment.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_member uuid; v_st text;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_paid_season('Sec R2 Withdraw League');
    v_member := pg_temp.reserve(v_sid, v_players[2]);
    -- abandoned checkout: the reaper withdraws the reservation.
    UPDATE season_members SET status = 'withdrawn', withdrawn_at = now() WHERE id = v_member;
    UPDATE lt_registration_payment SET status = 'cancelled' WHERE season_user_id = v_member;

    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM season_begin_paid_enrollment(v_sid);
    SELECT status INTO v_st FROM season_members WHERE id = v_member;
    ASSERT v_st = 'payment_pending', '2: withdrawn member must be able to retry, got ' || v_st;

    RAISE NOTICE 'PASS 2: voluntary-exit reuse branch intact';
END $$;

ROLLBACK;
