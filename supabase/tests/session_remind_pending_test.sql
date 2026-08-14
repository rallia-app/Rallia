-- ============================================
-- Leagues — the organizer can chase unanswered members (DB-level)
-- ============================================
-- Covers 20260731130000_lt_session_remind_pending.
--
-- The only nudge was a cron that fires once per session inside the last 24
-- hours before the deadline, so an organizer looking at unanswered members a
-- week out had nothing to press.
--
--   * the organizer reaches exactly the members still pending
--   * a second nudge inside the cooldown is refused
--   * a session where everyone answered reports NO_PENDING_MEMBERS
--   * a plain member cannot nudge
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_remind_pending_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"). Staff is granted around the create calls only and
-- dropped straight after: the fixture-picking helpers filter admins out, so a
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

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- A published future session with 5 members: 2 confirm, 1 declines, 2 never
-- answer. Only the two silent ones should be nudged.
CREATE OR REPLACE FUNCTION pg_temp.mk_session(
    p_name    text,
    p_org_idx int,
    OUT o_org uuid,
    OUT o_p   uuid[],
    OUT o_sid uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid; v_l leagues; v_s seasons; v_sess sessions; v_i int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 46) s;
    ASSERT array_length(o_p, 1) = 46, 'need 46 active non-admin tennis players';
    -- Tail of the pool: league_create allows a non-admin 5 per 24h and the rest
    -- of the suite organizes from the head.
    o_org := o_p[42 + p_org_idx];

    PERFORM pg_temp.as_user(o_org);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    FOR v_i IN 31..35 LOOP
        PERFORM pg_temp.as_user(o_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    SELECT * INTO v_sess FROM session_create(v_s.id, p_name, now() + interval '7 days');
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    o_sid := v_sess.id;

    PERFORM pg_temp.as_user(o_p[31]); PERFORM session_confirm_presence(o_sid, 'confirmed');
    PERFORM pg_temp.as_user(o_p[32]); PERFORM session_confirm_presence(o_sid, 'confirmed');
    PERFORM pg_temp.as_user(o_p[33]); PERFORM session_confirm_presence(o_sid, 'declined');
    -- 34 and 35 stay pending.
END $$;

-- --------------------------------------------------------------------------
-- 1. the nudge reaches exactly the pending members, once per cooldown
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sid uuid; v_n int; v_err text; v_notified int;
BEGIN
    SELECT o_org, o_p, o_sid INTO v_org, v_p, v_sid
      FROM pg_temp.mk_session('Remind — pending', 1);

    -- The organizer is a member of their own league and has not answered
    -- either, so three rows are pending; the nudge must skip the caller.
    ASSERT (SELECT count(*) FROM session_presence
             WHERE session_id = v_sid AND status = 'pending') = 3,
        'the fixture must leave two members plus the organizer unanswered';

    PERFORM pg_temp.as_user(v_org);
    v_n := session_remind_pending(v_sid);
    ASSERT v_n = 2, format('two pending members must be nudged, got %s', v_n);

    -- The two silent members got it; the ones who answered did not.
    SELECT count(*) INTO v_notified
      FROM notification
     WHERE type = 'session_confirm_reminder'
       AND user_id IN (v_p[34], v_p[35]);
    ASSERT v_notified = 2, format('both silent members must be notified, got %s', v_notified);

    SELECT count(*) INTO v_notified
      FROM notification
     WHERE type = 'session_confirm_reminder'
       AND user_id IN (v_p[31], v_p[32], v_p[33]);
    ASSERT v_notified = 0, 'members who already answered must not be nudged';

    -- A second press inside the cooldown is refused.
    BEGIN
        PERFORM session_remind_pending(v_sid);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'REMINDER_TOO_SOON',
        format('a second nudge inside the cooldown must be refused, got %s', v_err);

    RAISE NOTICE 'PASS: the nudge reaches only pending members and rate limits';
END $$;

-- --------------------------------------------------------------------------
-- 2. nothing to chase, and who may chase
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sid uuid; v_err text;
BEGIN
    SELECT o_org, o_p, o_sid INTO v_org, v_p, v_sid
      FROM pg_temp.mk_session('Remind — authz', 2);

    -- A plain member cannot nudge, even one who is on the roster.
    PERFORM pg_temp.as_user(v_p[31]);
    BEGIN
        PERFORM session_remind_pending(v_sid);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'NOT_ORGANIZER',
        format('a member must not be able to nudge, got %s', v_err);

    -- Everyone answers, so there is nobody left to chase.
    PERFORM pg_temp.as_user(v_p[34]); PERFORM session_confirm_presence(v_sid, 'confirmed');
    PERFORM pg_temp.as_user(v_p[35]); PERFORM session_confirm_presence(v_sid, 'declined');

    PERFORM pg_temp.as_user(v_org);
    BEGIN
        PERFORM session_remind_pending(v_sid);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'NO_PENDING_MEMBERS',
        format('a fully answered session must say so, got %s', v_err);

    RAISE NOTICE 'PASS: only the organizer nudges, and only when someone is silent';
END $$;

ROLLBACK;
