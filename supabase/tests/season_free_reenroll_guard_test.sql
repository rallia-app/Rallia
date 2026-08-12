-- ============================================
-- Season free-path — removed-member re-entry guard (20260722110000)
--
-- Regression for the two free-path doors a removed ('disqualified') season
-- member could walk back in through after 20260722100000 closed the paid one:
--   * season_enroll's reuse UPDATE flipped a disqualified row back to
--     'enrolled' (outright on a free season; on a paid season during the
--     pre-refund-cron window, because the payment gate resolves "paid" by
--     (season_id, user_id) and the old succeeded payment still qualifies).
--   * session_confirm_presence's auto-enroll upsert did the same on confirm.
-- Pre-fix, tests 1, 2 and 4 here fail.
--
-- Convention (shared with every other file in this dir): one transaction,
-- ROLLBACK at the end, ASSERT for every check so a regression is a hard error
-- with a non-zero psql exit. Auth is simulated via the request.jwt.claims GUC
-- that auth.uid() reads. Runs as postgres, which bypasses RLS — the SECURITY
-- DEFINER RPCs and their triggers are what's under test.
--
--   psql "$(npx supabase status -o json | jq -r .DB_URL)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/season_free_reenroll_guard_test.sql
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- Helpers (mirrors of season_paid_reenroll_guard_test.sql's).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_player(p_player uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_player::text)::text, true);
$$;

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"). Staff is granted around the create call only and
-- dropped straight after: the fixture-picking queries filter admins out, so a
-- lingering row would shift which players a later block picks, and the
-- organizer has to stay an ordinary player for the authz assertions to mean
-- anything.
-- SECURITY DEFINER so the grant still works inside a block that has switched
-- to the authenticated role, where admin's RLS would refuse the insert.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- Open season with players[2..] as active league members; free unless a fee is
-- passed.
CREATE OR REPLACE FUNCTION pg_temp.mk_season(
    p_name        text,
    p_fee_cents   integer DEFAULT 0,
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
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_league FROM league_create(
        p_name => p_name, p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    FOR i IN 2..4 LOOP
        PERFORM pg_temp.as_player(o_players[i]);
        PERFORM league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_player(o_org);
    SELECT * INTO v_season FROM season_create(
        p_league_id => v_league.id, p_name => 'S1',
        p_start_date => current_date, p_end_date => current_date + 90);
    IF p_fee_cents > 0 THEN
        UPDATE seasons SET entry_fee_cents = p_fee_cents, currency = 'CAD',
                           fee_payer = 'player_pays'
         WHERE id = v_season.id;
        INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
        VALUES (o_org, 'acct_test_' || left(o_org::text, 8), true)
        ON CONFLICT (player_id) DO UPDATE SET charges_enabled = true;
    END IF;

    SELECT version INTO v_season.version FROM seasons WHERE id = v_season.id;
    SELECT * INTO v_season FROM season_open(v_season.id, v_season.version);
    o_sid := v_season.id;
END $$;

-- Organizer removes a member by (season, user); returns nothing, asserts state.
CREATE OR REPLACE FUNCTION pg_temp.remove_member(p_org uuid, p_sid uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_v int; v_st text;
BEGIN
    SELECT id, version INTO v_id, v_v FROM season_members
     WHERE season_id = p_sid AND user_id = p_user;
    PERFORM pg_temp.as_player(p_org);
    PERFORM season_remove_member(v_id, v_v);
    SELECT status INTO v_st FROM season_members WHERE id = v_id;
    ASSERT v_st = 'disqualified', 'removal must mark disqualified, got ' || v_st;
END $$;

-- ==========================================================================
-- 1. Free season: a removed member cannot season_enroll back in.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_ok boolean; v_st text; v_v int;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_season('Sec F1 Free Reenroll League');

    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM season_enroll(v_sid);
    PERFORM pg_temp.remove_member(v_org, v_sid, v_players[2]);
    SELECT version INTO v_v FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[2];

    -- Pre-fix this flipped the row straight back to 'enrolled'.
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM season_enroll(v_sid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ENROLLMENT_REMOVED'); END;
    ASSERT v_ok, '1: removed member re-enrolling must raise ENROLLMENT_REMOVED';

    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[2];
    ASSERT v_st = 'disqualified', '1: row must stay disqualified, got ' || v_st;
    ASSERT (SELECT version FROM season_members
             WHERE season_id = v_sid AND user_id = v_players[2]) = v_v,
        '1: refusal must not touch the row';

    RAISE NOTICE 'PASS 1: free season_enroll refuses a removed member';
END $$;

-- ==========================================================================
-- 2. A removed member cannot confirm session presence back onto the roster.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_session sessions;
    v_ok boolean; v_st text;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_season('Sec F2 Free Confirm League');

    PERFORM pg_temp.as_player(v_org);
    SELECT * INTO v_session FROM session_create(
        p_season_id => v_sid, p_name => 'Week 1',
        p_scheduled_at => now() + interval '7 days');
    SELECT * INTO v_session FROM session_publish(v_session.id, NULL, v_session.version);

    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM season_enroll(v_sid);
    PERFORM pg_temp.remove_member(v_org, v_sid, v_players[2]);

    -- Pre-fix the auto-enroll upsert flipped them back to 'enrolled' and the
    -- confirm seated them in the session.
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM session_confirm_presence(v_session.id, 'confirmed');
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ENROLLMENT_REMOVED'); END;
    ASSERT v_ok, '2: removed member confirming must raise ENROLLMENT_REMOVED';

    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[2];
    ASSERT v_st = 'disqualified', '2: roster row must stay disqualified, got ' || v_st;
    -- Publish pre-seeds a 'pending' presence row per active member; the refusal
    -- must leave it there rather than flipping it to confirmed.
    SELECT status INTO v_st FROM session_presence
     WHERE session_id = v_session.id AND user_id = v_players[2];
    ASSERT v_st = 'pending', '2: refusal must not seat them in the session, got ' || v_st;

    -- Declining stays allowed: it neither enrolls nor takes a seat.
    PERFORM session_confirm_presence(v_session.id, 'declined');
    SELECT status INTO v_st FROM session_presence
     WHERE session_id = v_session.id AND user_id = v_players[2];
    ASSERT v_st = 'declined', '2: a removed member may still decline, got ' || v_st;
    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[2];
    ASSERT v_st = 'disqualified', '2: declining must not re-enroll, got ' || v_st;

    -- Positive control: the auto-enroll still works for everyone else — a
    -- never-enrolled member and a withdrawn one both land on the roster.
    PERFORM pg_temp.as_player(v_players[3]);
    PERFORM session_confirm_presence(v_session.id, 'confirmed');
    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[3];
    ASSERT v_st = 'enrolled', '2: fresh confirm must auto-enroll, got ' || v_st;

    PERFORM pg_temp.as_player(v_players[4]);
    PERFORM season_enroll(v_sid);
    PERFORM season_withdraw(v_sid);
    PERFORM session_confirm_presence(v_session.id, 'confirmed');
    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[4];
    ASSERT v_st = 'enrolled', '2: withdrawn confirm must re-enroll, got ' || v_st;

    RAISE NOTICE 'PASS 2: confirm-presence refuses a removed member, others unaffected';
END $$;

-- ==========================================================================
-- 3. Positive control: a voluntarily withdrawn member may season_enroll again.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_st text;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_season('Sec F3 Withdraw League');

    PERFORM pg_temp.as_player(v_players[2]);
    PERFORM season_enroll(v_sid);
    PERFORM season_withdraw(v_sid);
    PERFORM season_enroll(v_sid);
    SELECT status INTO v_st FROM season_members
     WHERE season_id = v_sid AND user_id = v_players[2];
    ASSERT v_st = 'enrolled', '3: withdrawn member must be able to re-enroll, got ' || v_st;

    RAISE NOTICE 'PASS 3: voluntary-exit re-enroll intact';
END $$;

-- ==========================================================================
-- 4. Paid pre-refund window: the removed member's old succeeded payment must
--    not let season_enroll flip them back before the refund cron runs.
-- ==========================================================================
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_sid uuid; v_member uuid;
    v_ok boolean; v_st text;
BEGIN
    SELECT o_org, o_players, o_sid INTO v_org, v_players, v_sid
      FROM pg_temp.mk_season('Sec F4 Paid Window League', 5000);

    -- Paid enrollment, webhook-simulated to succeeded/enrolled.
    PERFORM pg_temp.as_player(v_players[2]);
    SELECT season_user_id INTO v_member FROM season_begin_paid_enrollment(v_sid);
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_charge_id = 'ch_' || left(v_member::text, 8)
     WHERE season_user_id = v_member AND status = 'pending';
    UPDATE season_members SET status = 'enrolled' WHERE id = v_member;

    PERFORM pg_temp.remove_member(v_org, v_sid, v_players[2]);

    -- Refund not yet processed: the succeeded payment still resolves for
    -- (season_id, user_id), so pre-fix the payment gate waved this through.
    v_ok := false;
    PERFORM pg_temp.as_player(v_players[2]);
    BEGIN PERFORM season_enroll(v_sid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'ENROLLMENT_REMOVED'); END;
    ASSERT v_ok, '4: removed paid member must get ENROLLMENT_REMOVED, not re-enroll';

    SELECT status INTO v_st FROM season_members WHERE id = v_member;
    ASSERT v_st = 'disqualified', '4: row must stay disqualified, got ' || v_st;

    -- Their entry is still queued for refund, untouched by the attempt.
    ASSERT EXISTS (SELECT 1 FROM lt_cancel_refund_candidates() c
                    JOIN lt_registration_payment p ON p.id = c.payment_id
                   WHERE p.season_user_id = v_member),
        '4: removed member''s entry must remain a refund candidate';

    RAISE NOTICE 'PASS 4: paid pre-refund window closed on the free-path door';
END $$;

ROLLBACK;
