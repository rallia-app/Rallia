-- ============================================
-- Tournaments — organizer gate nudges
-- ============================================
-- lt_nudge_tournament_gates pokes the organizer when a tournament is parked at
-- a gate only they can open. Asserts it fires for both gates, reaches
-- co-organizers, holds its 48h cadence, and stays quiet in the three cases
-- where a nudge would be wrong: a pool game still disputed, too few entrants
-- for the draw to succeed at all, and a gate that has already been opened.
--
-- Counts are read off the notification table filtered to each fixture, never
-- off the function's return value: the sweep is global and this database has
-- other tournaments in it.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_gate_nudges_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

CREATE OR REPLACE FUNCTION pg_temp.tennis_players(n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id
      FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active = true AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t;
$$;

CREATE OR REPLACE FUNCTION pg_temp.nudges(p_t uuid, p_gate text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM notification n
   WHERE n.type = 'tournament_action_required'
     AND n.payload->>'tournamentId' = p_t::text
     AND n.payload->>'gate' = p_gate;
$$;

DO $$
DECLARE
    v_p       uuid[];
    v_org1    uuid;
    v_org2    uuid;
    v_org3    uuid;
    v_coorg   uuid;
    v_t1      uuid;
    v_t2      uuid;
    v_t3      uuid;
    v_row     tournaments;
    v_ver     integer;
    v_tm      tournament_matches;
    v_last    uuid;
    v_n       integer;
BEGIN
    v_p     := pg_temp.tennis_players(14);
    v_org1  := v_p[9];
    v_org2  := v_p[10];
    v_org3  := v_p[11];
    v_coorg := v_p[12];

    -- ---- T1: pool tournament, registration closed, nothing drawn ----------
    PERFORM pg_temp.as_user(v_org1);
    SELECT * INTO v_row FROM public.tournament_create(
        '[TEST-GATE] Pools', (SELECT id FROM sport WHERE name = 'tennis'),
        8::smallint, now() + interval '5 days', now() + interval '25 days',
        p_bracket_type => 'pool_knockout');
    v_t1 := v_row.id;
    INSERT INTO tournament_co_organizers (tournament_id, user_id, added_by)
    VALUES (v_t1, v_coorg, v_org1);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t1;
    PERFORM public.tournament_open_registration(v_t1, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_p[i]);
        PERFORM public.tournament_register(v_t1, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org1);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t1;
    PERFORM public.tournament_close_registration(v_t1, v_ver);

    PERFORM public.lt_nudge_tournament_gates();
    -- Organizer + co-organizer.
    IF pg_temp.nudges(v_t1, 'pools') <> 2 THEN
        RAISE EXCEPTION 'gate 1 reached % recipients, expected organizer + co-organizer',
            pg_temp.nudges(v_t1, 'pools');
    END IF;

    -- Cadence: a second sweep inside 48h must not re-nudge.
    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t1, 'pools') <> 2 THEN
        RAISE EXCEPTION 'gate 1 re-nudged inside its 48h window (now %)',
            pg_temp.nudges(v_t1, 'pools');
    END IF;

    -- ---- T2: too few entrants for pools to be generatable at all ---------
    PERFORM pg_temp.as_user(v_org2);
    SELECT * INTO v_row FROM public.tournament_create(
        '[TEST-GATE] Too small', (SELECT id FROM sport WHERE name = 'tennis'),
        8::smallint, now() + interval '5 days', now() + interval '25 days',
        p_bracket_type => 'pool_knockout');
    v_t2 := v_row.id;
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t2;
    PERFORM public.tournament_open_registration(v_t2, v_ver);
    FOR i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_p[i]);
        PERFORM public.tournament_register(v_t2, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org2);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t2;
    PERFORM public.tournament_close_registration(v_t2, v_ver);

    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t2, 'pools') <> 0 THEN
        RAISE EXCEPTION 'told the organizer to start pools that cannot be generated (5 entrants)';
    END IF;
    -- ...but it must not stay silent either: that was the one gate stall with
    -- no notification at all.
    IF pg_temp.nudges(v_t2, 'short_field') <> 1 THEN
        RAISE EXCEPTION 'short field went unreported (% short_field notices)',
            pg_temp.nudges(v_t2, 'short_field');
    END IF;
    SELECT count(*) INTO v_n FROM notification n
     WHERE n.payload->>'tournamentId' = v_t2::text
       AND n.payload->>'gate' = 'short_field'
       AND (n.payload->>'entered')::int = 5
       AND (n.payload->>'needed')::int = 6
       AND n.body LIKE '%6%';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'short-field notice did not carry the real numbers';
    END IF;

    -- Reopening starts a fresh cycle, so the stamp must clear or the next close
    -- would wait out the leftover 48h before saying anything.
    PERFORM pg_temp.as_user(v_org2);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t2;
    PERFORM public.tournament_reopen_registration(v_t2, v_ver);
    IF (SELECT draw_nudged_at FROM tournaments WHERE id = v_t2) IS NOT NULL THEN
        RAISE EXCEPTION 'reopening left the gate-nudge stamp in place';
    END IF;

    -- ---- T3: single elimination stalls at the same gate -------------------
    PERFORM pg_temp.as_user(v_org3);
    SELECT * INTO v_row FROM public.tournament_create(
        '[TEST-GATE] Bracket', (SELECT id FROM sport WHERE name = 'tennis'),
        4::smallint, now() + interval '5 days', now() + interval '25 days',
        p_bracket_type => 'single_elimination');
    v_t3 := v_row.id;
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t3;
    PERFORM public.tournament_open_registration(v_t3, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_p[i]);
        PERFORM public.tournament_register(v_t3, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org3);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t3;
    PERFORM public.tournament_close_registration(v_t3, v_ver);

    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t3, 'bracket') <> 1 THEN
        RAISE EXCEPTION 'single-elim gate reached % recipients, expected 1',
            pg_temp.nudges(v_t3, 'bracket');
    END IF;

    -- ---- The short-field floor differs by structure -----------------------
    -- Straight on the rows: tournament_withdraw is registration_open only, and
    -- the point here is the floor, not the withdrawal path.
    UPDATE tournament_registrations SET status = 'withdrawn'
     WHERE tournament_id = v_t3
       AND user_id IN (v_p[2], v_p[3], v_p[4]);
    UPDATE tournaments SET draw_nudged_at = NULL WHERE id = v_t3;
    PERFORM public.lt_nudge_tournament_gates();
    SELECT count(*) INTO v_n FROM notification n
     WHERE n.payload->>'tournamentId' = v_t3::text
       AND n.payload->>'gate' = 'short_field'
       AND (n.payload->>'needed')::int = 2;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'a bracket short of entrants should need 2, got % notices', v_n;
    END IF;
    -- Put it back for the abandoned-event check below.
    UPDATE tournament_registrations SET status = 'registered'
     WHERE tournament_id = v_t3 AND status = 'withdrawn';

    -- ---- Gate 1 closes once the draw exists ------------------------------
    PERFORM pg_temp.as_user(v_org1);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t1;
    PERFORM public.tournament_generate_pools(v_t1, v_ver);
    UPDATE tournaments SET draw_nudged_at = NULL WHERE id = v_t1;  -- re-arm
    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t1, 'pools') <> 2 THEN
        RAISE EXCEPTION 'gate 1 still nudging after the pools were generated';
    END IF;

    -- ---- Gate 2: silent while a pool game is disputed --------------------
    FOR v_tm IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = v_t1 AND bracket_side = 'pool'
         ORDER BY round_number, match_position
    LOOP
        v_last := v_tm.id;
    END LOOP;

    PERFORM pg_temp.as_user(v_org1);
    FOR v_tm IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = v_t1 AND bracket_side = 'pool' AND id <> v_last
    LOOP
        PERFORM public.tournament_override_score(
            v_tm.id, v_tm.player1_registration_id, '6-2 6-2');
    END LOOP;
    UPDATE tournament_matches SET status = 'disputed' WHERE id = v_last;

    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t1, 'knockout') <> 0 THEN
        RAISE EXCEPTION 'nudged the knockout gate while a pool game was disputed';
    END IF;

    -- ---- Gate 2 fires once every pool game is terminal -------------------
    -- Settled straight on the row: the point here is the sweep's gate, not the
    -- score path, and override refuses a disputed row.
    UPDATE tournament_matches
       SET status = 'completed',
           winner_registration_id = player1_registration_id,
           score = '6-3 6-3', played_at = now()
     WHERE id = v_last;

    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t1, 'knockout') <> 2 THEN
        RAISE EXCEPTION 'gate 2 reached % recipients, expected organizer + co-organizer',
            pg_temp.nudges(v_t1, 'knockout');
    END IF;

    -- ---- Gate 2 closes once the knockout exists --------------------------
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t1;
    PERFORM public.tournament_generate_knockout(v_t1, v_ver);
    UPDATE tournaments SET knockout_nudged_at = NULL WHERE id = v_t1;  -- re-arm
    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t1, 'knockout') <> 2 THEN
        RAISE EXCEPTION 'gate 2 still nudging after the knockout was launched';
    END IF;

    -- ---- An abandoned event stops nagging --------------------------------
    -- Whole window moved back, not just end_date: tournaments_date_order.
    UPDATE tournaments
       SET status                 = 'registration_closed',
           registration_closes_at = now() - interval '41 days',
           start_date             = now() - interval '40 days',
           end_date               = now() - interval '30 days',
           draw_nudged_at         = NULL
     WHERE id = v_t3;
    PERFORM public.lt_nudge_tournament_gates();
    IF pg_temp.nudges(v_t3, 'bracket') <> 1 THEN
        RAISE EXCEPTION 'kept nudging an event 30 days past its end date';
    END IF;

    RAISE NOTICE 'tournament_gate_nudges_test: ALL PASS';
END;
$$;

ROLLBACK;
