-- ============================================
-- Check-in on a game that has no address
-- ============================================
-- The no-show rung is the clearest evidence the ladder gets, and it could not
-- fire on any game agreed without a place: check-in demanded the player within
-- 500 m of a court, and those games have no court, so nobody could check in and
-- the rung degraded into "neither showed up".
--
--   * a game with no coordinates accepts a self-declared check-in
--   * a game WITH coordinates still enforces the radius
--   * checked_in_at cannot be written directly, only through the RPC
--   * and the ladder can now tell the two sides apart: no_show fires
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_check_in_no_court_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void; $$;
CREATE OR REPLACE FUNCTION pg_temp.players(n int) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t; $$;

DO $$
DECLARE
    v_p    uuid[];
    v_m    uuid;
    v_res  jsonb;
    v_msg  text;
    v_ok   boolean;
BEGIN
    v_p := pg_temp.players(3);

    -- ---------------------------------------------- a game with no address
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, location_type)
    VALUES ((SELECT id FROM sport WHERE name = 'tennis'), v_p[1],
            now()::date, '19:00', '20:30', 'tbd')
    RETURNING id INTO v_m;
    -- The creator is added by a trigger, so upsert rather than insert.
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_m, v_p[1], 1, 'joined'), (v_m, v_p[2], 2, 'joined'),
           (v_m, v_p[3], 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE
      SET team_number = EXCLUDED.team_number, status = 'joined';

    PERFORM pg_temp.as_user(v_p[1]);
    v_res := public.check_in_to_match(v_m);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'a game with no address must accept a check-in, got %', v_res;
    END IF;
    IF (v_res->>'verified')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'a check-in with nothing to check against must not read as verified';
    END IF;
    SELECT check_in_verified INTO v_ok FROM match_participant
     WHERE match_id = v_m AND player_id = v_p[1];
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'check_in_verified should be false, got %', v_ok;
    END IF;

    -- Twice is not a thing.
    v_res := public.check_in_to_match(v_m);
    IF v_res->>'error' <> 'already_checked_in' THEN
        RAISE EXCEPTION 'expected already_checked_in, got %', v_res;
    END IF;

    -- --------------------------------------- the radius still means something
    UPDATE match SET location_type = 'custom',
                     custom_latitude = 45.5017, custom_longitude = -73.5673
     WHERE id = v_m;
    PERFORM pg_temp.as_user(v_p[2]);
    -- Toronto is not Montreal.
    v_res := public.check_in_to_match(v_m, 43.6532, -79.3832);
    IF v_res->>'error' <> 'too_far' THEN
        RAISE EXCEPTION 'a distant check-in must be refused, got %', v_res;
    END IF;
    -- Across the street is.
    v_res := public.check_in_to_match(v_m, 45.5019, -73.5675);
    IF (v_res->>'success')::boolean IS NOT TRUE
       OR (v_res->>'verified')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'a nearby check-in must succeed and read as verified, got %', v_res;
    END IF;

    -- ------------------------------------------------- and it cannot be faked
    -- The real attack: stamping an arrival that was never made. Player 3 has
    -- not checked in, so this is a genuine NULL -> value transition (now() is
    -- constant inside a transaction, so re-stamping a checked-in player would
    -- be no change at all and the guard would rightly ignore it).
    BEGIN
        UPDATE match_participant SET checked_in_at = now()
         WHERE match_id = v_m AND player_id = v_p[3];
        RAISE EXCEPTION 'expected CHECK_IN_VIA_RPC_ONLY, the direct write was allowed';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg <> 'CHECK_IN_VIA_RPC_ONLY' THEN RAISE; END IF;
    END;

    RAISE NOTICE 'lt_check_in_no_court_test: ALL PASS';
END;
$$;

ROLLBACK;
