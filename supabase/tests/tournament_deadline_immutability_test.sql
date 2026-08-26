-- ============================================
-- Tournaments — a deadline is frozen once it passes, and cannot be pulled in
-- ============================================
-- Covers 20260825160000_lt_deadline_immutable_after_expiry.sql:
--   DEADLINE_PASSED    changing a stored deadline that is already behind us
--   DEADLINE_TOO_SOON  pulling a future deadline inside 48 h
--   and the two directions that must still work: pushing back, and a no-op.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_deadline_immutability_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

-- Admins are filtered out: is_admin() short-circuits the organizer gate, so an
-- admin fixture would pass the deny-path tests for the wrong reason.
CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- Writes a deadline straight to the table, bypassing the RPC, so a test can
-- set up a state the RPC itself would now refuse to create.
CREATE OR REPLACE FUNCTION pg_temp.force_deadline(t uuid, at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE tournament_round_deadlines SET deadline_at = at
   WHERE tournament_id = t AND bracket_side = 'pool' AND round_number = 0;
$$;

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_dl        timestamptz;
    i           integer;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[9];

    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-DL] Immutability', (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '7 days', now() + interval '35 days',
        p_bracket_type => 'pool_knockout');
    PERFORM pg_temp.staff_off(v_organizer);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- Publishing pools seeds a pool deadline; park it far out as the baseline.
    PERFORM public.tournament_set_round_deadlines(v_t.id,
        jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', now() + interval '20 days')));

    -- 1. Pushing it back further is always allowed.
    PERFORM public.tournament_set_round_deadlines(v_t.id,
        jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', now() + interval '25 days')));
    SELECT deadline_at INTO v_dl FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;
    IF v_dl < now() + interval '24 days' THEN
        RAISE EXCEPTION 'push-back was not applied: %', v_dl;
    END IF;

    -- 2. Pulling it in, but still beyond 48 h, is allowed.
    PERFORM public.tournament_set_round_deadlines(v_t.id,
        jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', now() + interval '5 days')));

    -- 3. Pulling it inside 48 h is refused.
    BEGIN
        PERFORM public.tournament_set_round_deadlines(v_t.id,
            jsonb_build_array(jsonb_build_object(
                'bracket_side', 'pool', 'round_number', 0,
                'deadline_at', now() + interval '10 hours')));
        RAISE EXCEPTION 'expected DEADLINE_TOO_SOON';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEADLINE_TOO_SOON' THEN RAISE; END IF;
    END;

    -- The refusal left the stored value alone.
    SELECT deadline_at INTO v_dl FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;
    IF v_dl < now() + interval '4 days' THEN
        RAISE EXCEPTION 'refused pull-in still wrote: %', v_dl;
    END IF;

    -- 4. Once the deadline is behind us, it is frozen in every direction.
    PERFORM pg_temp.force_deadline(v_t.id, now() - interval '2 hours');
    BEGIN
        PERFORM public.tournament_set_round_deadlines(v_t.id,
            jsonb_build_array(jsonb_build_object(
                'bracket_side', 'pool', 'round_number', 0,
                'deadline_at', now() + interval '10 days')));
        RAISE EXCEPTION 'expected DEADLINE_PASSED';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEADLINE_PASSED' THEN RAISE; END IF;
    END;

    -- 5. Resubmitting a passed deadline unchanged is a no-op, not an error:
    --    a caller that posts its whole set is not punished for stale rows.
    SELECT deadline_at INTO v_dl FROM tournament_round_deadlines
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;
    PERFORM public.tournament_set_round_deadlines(v_t.id,
        jsonb_build_array(jsonb_build_object(
            'bracket_side', 'pool', 'round_number', 0,
            'deadline_at', v_dl)));

    RAISE NOTICE 'tournament_deadline_immutability_test: ALL PASS';
END;
$$;

ROLLBACK;
