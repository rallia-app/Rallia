-- ============================================
-- Leagues — swapping a player on the match sheet
-- ============================================
-- Covers 20260807340000: session_swap_player. Four players make two pairings,
-- so both the paired-for-paired trade and the bye-player substitution have
-- somewhere to happen, and a fifth sits on a bye.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_session_swap_player_test.sql
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

/** The pairing a player sits in, or NULL when they are on a bye. */
CREATE OR REPLACE FUNCTION pg_temp.match_of(p_session uuid, p_user uuid) RETURNS uuid
LANGUAGE sql AS $$
  SELECT id FROM session_matches
   WHERE session_id = p_session AND is_drill = false
     AND (p_user = ANY (team_a_user_ids) OR p_user = ANY (team_b_user_ids))
   LIMIT 1;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_sport   uuid;
    v_league  leagues;
    v_season  seasons;
    v_sess    sessions;
    v_m1      uuid;
    v_m2      uuid;
    v_bye     uuid;
    v_a       uuid;
    v_b       uuid;
    v_match   session_matches;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_players := pg_temp.tennis_players(5);
    v_org := v_players[1];

    PERFORM pg_temp.as_user(v_org);
    v_league := public.league_create(
        p_name => 'Swap test', p_sport_id => v_sport, p_join_mode => 'open');

    FOR i IN 2..5 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'N1', now() + interval '3 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    FOR i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    -- Five confirmed singles players: two pairings and one bye.
    SELECT user_id INTO v_bye
      FROM session_presence sp
     WHERE sp.session_id = v_sess.id AND sp.status = 'confirmed'
       AND pg_temp.match_of(v_sess.id, sp.user_id) IS NULL
     LIMIT 1;
    IF v_bye IS NULL THEN
        RAISE EXCEPTION 'expected an odd roster to leave someone on a bye';
    END IF;

    -- ------------------------------------------------------------------
    -- 1. a bye player takes the slot of someone who cancelled
    -- ------------------------------------------------------------------
    SELECT team_a_user_ids[1] INTO v_a
      FROM session_matches WHERE session_id = v_sess.id AND is_drill = false LIMIT 1;
    v_m1 := pg_temp.match_of(v_sess.id, v_a);

    v_sess := public.session_swap_player(v_sess.id, v_a, v_bye, v_sess.version);

    IF pg_temp.match_of(v_sess.id, v_bye) <> v_m1 THEN
        RAISE EXCEPTION 'the bye player did not take the slot';
    END IF;
    IF pg_temp.match_of(v_sess.id, v_a) IS NOT NULL THEN
        RAISE EXCEPTION 'the replaced player is still on the sheet';
    END IF;
    RAISE NOTICE 'ok 1: a bye player replaces a cancellation';

    -- ------------------------------------------------------------------
    -- 2. two paired players trade places
    -- ------------------------------------------------------------------
    SELECT team_a_user_ids[1] INTO v_a
      FROM session_matches
     WHERE session_id = v_sess.id AND is_drill = false AND id = v_m1;
    SELECT team_a_user_ids[1] INTO v_b
      FROM session_matches
     WHERE session_id = v_sess.id AND is_drill = false AND id <> v_m1 LIMIT 1;
    v_m2 := pg_temp.match_of(v_sess.id, v_b);

    v_sess := public.session_swap_player(v_sess.id, v_a, v_b, v_sess.version);

    IF pg_temp.match_of(v_sess.id, v_a) <> v_m2 OR pg_temp.match_of(v_sess.id, v_b) <> v_m1 THEN
        RAISE EXCEPTION 'the two players did not trade pairings';
    END IF;
    RAISE NOTICE 'ok 2: two paired players trade places';

    -- ------------------------------------------------------------------
    -- 3. a stale version is refused
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.session_swap_player(v_sess.id, v_a, v_b, v_sess.version - 1);
        RAISE EXCEPTION 'a stale version was accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'OPTIMISTIC_LOCK_CONFLICT' THEN RAISE; END IF;
        RAISE NOTICE 'ok 3: a stale copy cannot swap';
    END;

    -- ------------------------------------------------------------------
    -- 4. someone who never confirmed cannot be dropped in
    -- ------------------------------------------------------------------
    BEGIN
        PERFORM public.session_swap_player(
            v_sess.id, v_a, '00000000-0000-0000-0000-000000000001'::uuid, v_sess.version);
        RAISE EXCEPTION 'an unconfirmed player was accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'PLAYER_NOT_CONFIRMED' THEN RAISE; END IF;
        RAISE NOTICE 'ok 4: only confirmed players can be swapped in';
    END;

    -- ------------------------------------------------------------------
    -- 5. once a score is in, that pairing is settled
    -- ------------------------------------------------------------------
    SELECT * INTO v_match FROM session_matches WHERE id = v_m2;
    PERFORM public.session_record_score(v_match.id, 'a', '6-4 6-2', 'completed', v_match.version);

    -- Scoring can move the session version; re-read it so the refusal below is
    -- the played-match rule and not a stale copy.
    SELECT * INTO v_sess FROM sessions WHERE id = v_sess.id;

    -- v_b sits in the other, still-unplayed pairing, so this is a genuine
    -- attempt to touch a settled row.
    BEGIN
        PERFORM public.session_swap_player(
            v_sess.id, v_match.team_a_user_ids[1], v_b, v_sess.version);
        RAISE EXCEPTION 'a scored pairing was swapped';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'MATCH_ALREADY_PLAYED' THEN RAISE; END IF;
        RAISE NOTICE 'ok 5: a played pairing is no longer adjustable';
    END;
END $$;

ROLLBACK;
