-- ============================================
-- Leagues — the organizer can free a seat and the waitlist moves (DB-level)
-- ============================================
-- Covers 20260730200000_lt_session_withdraw_member.
--
-- session_confirm_presence only ever acts on auth.uid(), so nothing could
-- change another member's presence and an organizer had no way to free a seat.
-- Reported as "il m'etait impossible de retirer un joueur confirme pour en voir
-- monter un de la liste d'attente".
--
--   * withdrawing a confirmed member promotes the waitlist head
--   * a waitlisted member can be withdrawn too
--   * a non-organizer cannot withdraw anybody
--   * a member who already declined is not withdrawable again
--   * the organizer cannot use this to SEAT someone
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_withdraw_member_test.sql
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

-- --------------------------------------------------------------------------
-- Helper: a published session with capacity 2 and 4 members confirming, so two
-- are seated and two are queued.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_capped_session(
    p_name    text,
    p_org_idx int DEFAULT 1,
    OUT o_org uuid,
    OUT o_p   uuid[],
    OUT o_sid uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid; v_l leagues; v_sea seasons; v_sess sessions; v_i int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 30) s;
    ASSERT array_length(o_p, 1) = 30, 'need 30 active non-admin tennis players';
    -- league_create rate-limits a non-admin organizer to 5 per 24h, and the rest
    -- of the league suite draws its organizers from the head of this same
    -- ordered pool. Taking indices 20+ keeps this file from spending their quota
    -- and turning unrelated tests red when the whole suite runs in one session.
    o_org := o_p[19 + p_org_idx];

    PERFORM pg_temp.as_user(o_org);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    PERFORM pg_temp.staff_off(o_org);
    FOR v_i IN 24..28 LOOP
        PERFORM pg_temp.as_user(o_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_sea FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_sea FROM season_open(v_sea.id, v_sea.version);

    SELECT * INTO v_sess FROM session_create(v_sea.id, p_name, now() + interval '3 days');
    UPDATE sessions SET capacity = 2 WHERE id = v_sess.id;
    SELECT * INTO v_sess FROM sessions WHERE id = v_sess.id;
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);
    o_sid := v_sess.id;

    -- Members 24..27 confirm in order: 24 and 25 seat, 26 and 27 queue. Member
    -- 28 never answers, so the authz test has a fellow member who is not seated.
    FOR v_i IN 24..27 LOOP
        PERFORM pg_temp.as_user(o_p[v_i]);
        PERFORM session_confirm_presence(o_sid, 'confirmed');
    END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- 1. withdrawing a confirmed member promotes the waitlist head
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sid uuid;
    v_seated uuid[]; v_queued uuid[]; v_head uuid; v_pres session_presence;
BEGIN
    SELECT o_org, o_p, o_sid INTO v_org, v_p, v_sid
      FROM pg_temp.mk_capped_session('Withdraw — promotes');

    SELECT array_agg(user_id ORDER BY user_id) INTO v_seated
      FROM session_presence WHERE session_id = v_sid AND status = 'confirmed';
    ASSERT array_length(v_seated, 1) = 2, 'capacity 2 must seat exactly two';

    SELECT user_id INTO v_head FROM session_presence
     WHERE session_id = v_sid AND status = 'waitlisted'
     ORDER BY waitlist_position ASC NULLS LAST, created_at ASC LIMIT 1;
    ASSERT v_head IS NOT NULL, 'someone must be queued for this test to mean anything';

    SELECT * INTO v_pres FROM session_presence
     WHERE session_id = v_sid AND user_id = v_seated[1];

    PERFORM pg_temp.as_user(v_org);
    PERFORM session_withdraw_member(v_sid, v_seated[1], v_pres.version);

    ASSERT (SELECT status FROM session_presence
             WHERE session_id = v_sid AND user_id = v_seated[1]) = 'declined',
        'the withdrawn member must read declined';
    ASSERT (SELECT waitlist_position FROM session_presence
             WHERE session_id = v_sid AND user_id = v_seated[1]) IS NULL,
        'a declined row must not keep a queue position';
    ASSERT (SELECT status FROM session_presence
             WHERE session_id = v_sid AND user_id = v_head) = 'confirmed',
        'the waitlist head must have been promoted into the freed seat';
    ASSERT (SELECT count(*) FROM session_presence
             WHERE session_id = v_sid AND status = 'confirmed') = 2,
        'the session must still be exactly at capacity';

    RAISE NOTICE 'PASS 1: withdrawing a confirmed member frees the seat and promotes the queue';
END $$;

-- --------------------------------------------------------------------------
-- 2. a waitlisted member can be withdrawn; a declined one cannot
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sid uuid; v_q uuid; v_pres session_presence; v_ok boolean := false;
BEGIN
    SELECT o_org, o_p, o_sid INTO v_org, v_p, v_sid
      FROM pg_temp.mk_capped_session('Withdraw — queued and declined', 2);

    SELECT user_id INTO v_q FROM session_presence
     WHERE session_id = v_sid AND status = 'waitlisted'
     ORDER BY waitlist_position DESC LIMIT 1;
    SELECT * INTO v_pres FROM session_presence WHERE session_id = v_sid AND user_id = v_q;

    PERFORM pg_temp.as_user(v_org);
    PERFORM session_withdraw_member(v_sid, v_q, v_pres.version);
    ASSERT (SELECT status FROM session_presence WHERE session_id = v_sid AND user_id = v_q)
           = 'declined', 'a queued member must be withdrawable';

    -- Second attempt on the same row is refused.
    SELECT * INTO v_pres FROM session_presence WHERE session_id = v_sid AND user_id = v_q;
    BEGIN
        PERFORM session_withdraw_member(v_sid, v_q, v_pres.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'PRESENCE_NOT_WITHDRAWABLE'); END;
    ASSERT v_ok, 'an already-declined member must not be withdrawable again';

    RAISE NOTICE 'PASS 2: queued members withdraw, declined ones are refused';
END $$;

-- --------------------------------------------------------------------------
-- 3. only the organizer may withdraw, and it cannot seat anyone
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sid uuid; v_seated uuid; v_pres session_presence;
    v_ok boolean := false; v_before session_presence_status;
BEGIN
    SELECT o_org, o_p, o_sid INTO v_org, v_p, v_sid
      FROM pg_temp.mk_capped_session('Withdraw — authz', 3);

    SELECT user_id INTO v_seated FROM session_presence
     WHERE session_id = v_sid AND status = 'confirmed' ORDER BY user_id LIMIT 1;
    SELECT * INTO v_pres FROM session_presence WHERE session_id = v_sid AND user_id = v_seated;

    -- A fellow member cannot remove a rival.
    PERFORM pg_temp.as_user(v_p[28]);
    BEGIN
        PERFORM session_withdraw_member(v_sid, v_seated, v_pres.version);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'NOT_ORGANIZER'); END;
    ASSERT v_ok, 'a non-organizer must not withdraw anybody';

    SELECT status INTO v_before FROM session_presence
     WHERE session_id = v_sid AND user_id = v_seated;
    ASSERT v_before = 'confirmed', 'a refused withdrawal must leave the seat alone';

    -- The RPC has no seating power: withdrawing only ever declines.
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_proc
         WHERE proname = 'session_withdraw_member'
           AND prosrc ILIKE '%= ''confirmed''%'
           AND prosrc ILIKE '%UPDATE session_presence%SET status%confirmed%'
    ), 'session_withdraw_member must never set a presence to confirmed';

    RAISE NOTICE 'PASS 3: organizer-only, and it cannot seat anyone';
END $$;

ROLLBACK;
