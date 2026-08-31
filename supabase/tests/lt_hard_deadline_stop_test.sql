-- ============================================
-- Tournaments — the deadline is a hard stop
-- ============================================
-- An organizer may move a pairing's deadline while it is still ahead, and may
-- not once it has passed. That second half is the point: the automatic grace
-- and the automatic extension were removed, and granting the same thing by
-- hand after the fact would put them straight back (Jean, 2026-08-31).
--
-- Also: a draw generated on or after its own end_date still gets deadlines,
-- because a draw with no clock is unlimited time.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_hard_deadline_stop_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;
CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM admin WHERE id = p; $$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_ver     integer;
    v_tm      tournament_matches;
    v_cnt     integer;
    v_msg     text;
BEGIN
    v_players := pg_temp.tennis_players(5);
    v_org     := v_players[5];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-HS] Hard stop', (SELECT id FROM sport WHERE name = 'tennis'), 4::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(v_org);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

    -- Generation always leaves a clock behind.
    SELECT count(*) INTO v_cnt FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'main';
    IF v_cnt < 1 THEN
        RAISE EXCEPTION 'generation must seed round deadlines, got %', v_cnt;
    END IF;

    SELECT * INTO v_tm FROM tournament_matches
     WHERE tournament_id = v_t.id AND round_number = 1 AND match_position = 1;

    -- While the deadline is ahead, the organizer may move it. This is the
    -- sanctioned accommodation and must keep working.
    PERFORM public.tournament_extend_match_deadline(
        v_tm.id, now() + interval '10 days', 'injury');
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    IF v_tm.deadline_override_at IS NULL THEN
        RAISE EXCEPTION 'an organizer must be able to move a future deadline';
    END IF;

    -- Once it has passed, it is the resolver's, not the organizer's.
    UPDATE tournament_matches SET deadline_override_at = now() - interval '1 hour'
     WHERE id = v_tm.id;
    BEGIN
        PERFORM public.tournament_extend_match_deadline(
            v_tm.id, now() + interval '3 days', 'just a bit more');
        RAISE EXCEPTION 'expected DEADLINE_PASSED, the extension was allowed';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg <> 'DEADLINE_PASSED' THEN RAISE; END IF;
    END;

    -- The same is true when only the round deadline has expired, with no
    -- per-pairing override in play at all.
    UPDATE tournament_matches SET deadline_override_at = NULL WHERE id = v_tm.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '2 hours'
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;
    BEGIN
        PERFORM public.tournament_extend_match_deadline(
            v_tm.id, now() + interval '3 days', 'the round ran late');
        RAISE EXCEPTION 'expected DEADLINE_PASSED on an expired round deadline';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg <> 'DEADLINE_PASSED' THEN RAISE; END IF;
    END;

    -- A draw whose end_date is already behind it still gets a clock, rather
    -- than silently getting unlimited time.
    PERFORM public._lt_seed_default_deadlines(
        v_t.id, 'pool', now(), now() - interval '5 days', 1);
    SELECT count(*) INTO v_cnt FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'an unusable end_date must still seed a deadline, got %', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND deadline_at > now();
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'the fallback deadline must be in the future';
    END IF;

    RAISE NOTICE 'lt_hard_deadline_stop_test: ALL PASS';
END;
$$;

ROLLBACK;
