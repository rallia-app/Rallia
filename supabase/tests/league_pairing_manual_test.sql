-- ============================================
-- Leagues — manual pairing leaves the choosing to the organizer
-- ============================================
-- Covers 20260820180000 + 20260820190000. Four players confirm in an order
-- that deliberately contradicts the ranking, so a sheet that still respects
-- the ranking would be indistinguishable from by_rank.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_pairing_manual_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

-- Who each player is paired against on the sheet, NULL on a bye.
CREATE OR REPLACE FUNCTION pg_temp.opponent_of(p_session uuid, p_user uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_user = ANY (sm.team_a_user_ids) THEN sm.team_b_user_ids[1]
              ELSE sm.team_a_user_ids[1] END
    FROM session_matches sm
   WHERE sm.session_id = p_session
     AND sm.is_drill = false
     AND (p_user = ANY (sm.team_a_user_ids) OR p_user = ANY (sm.team_b_user_ids))
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
    v_i       integer;
BEGIN
    v_players := pg_temp.tennis_players(4);
    v_org     := v_players[1];
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Manual pairing', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);

    FOR v_i IN 2..4 LOOP
        PERFORM pg_temp.as_user(v_players[v_i]);
        PERFORM public.league_join(v_league.id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(
        v_season.id, 'N1', now() + interval '3 days', p_pairing_mode => 'manual');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_players[v_i]);
        PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    -- Confirmation order 1, 3, 2, 4, stamped explicitly so the assertion tests
    -- the ordering rule rather than how fast the loop above ran. Every player
    -- sits on the season's default ranking (nobody has played, so they tie on
    -- points and fall through to the deterministic seed), and that seed order
    -- is precisely what manual has to ignore.
    UPDATE session_presence SET responded_at = now() + interval '1 second'
     WHERE session_id = v_sess.id AND user_id = v_players[1];
    UPDATE session_presence SET responded_at = now() + interval '2 seconds'
     WHERE session_id = v_sess.id AND user_id = v_players[3];
    UPDATE session_presence SET responded_at = now() + interval '3 seconds'
     WHERE session_id = v_sess.id AND user_id = v_players[2];
    UPDATE session_presence SET responded_at = now() + interval '4 seconds'
     WHERE session_id = v_sess.id AND user_id = v_players[4];

    PERFORM pg_temp.as_user(v_org);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    -- Confirmation order 1,3,2,4 pairs adjacent entries: 1 v 3 and 2 v 4.
    IF pg_temp.opponent_of(v_sess.id, v_players[1]) IS DISTINCT FROM v_players[3] THEN
        RAISE EXCEPTION 'manual should pair the first two to confirm, got %',
            pg_temp.opponent_of(v_sess.id, v_players[1]);
    END IF;
    IF pg_temp.opponent_of(v_sess.id, v_players[2]) IS DISTINCT FROM v_players[4] THEN
        RAISE EXCEPTION 'manual should pair the last two to confirm, got %',
            pg_temp.opponent_of(v_sess.id, v_players[2]);
    END IF;
    RAISE NOTICE 'ok 1: manual lays the roster out in confirmation order';

    -- It is still a draft, so the organizer rearranges before anyone sees it.
    IF v_sess.sheet_published_at IS NOT NULL THEN
        RAISE EXCEPTION 'a manual sheet must be a draft like any other';
    END IF;
    RAISE NOTICE 'ok 2: a manual sheet is a draft the organizer can rearrange';

    -- And the rearranging primitive reaches the other arrangement: swapping
    -- player 3 for player 2 inside round 1 makes it 1 v 2 and 3 v 4.
    PERFORM public.session_swap_player(
        v_sess.id,
        (SELECT id FROM session_matches
          WHERE session_id = v_sess.id AND is_drill = false
            AND (v_players[1] = ANY (team_a_user_ids) OR v_players[1] = ANY (team_b_user_ids))
          LIMIT 1),
        v_players[3], v_players[2], v_sess.version);

    IF pg_temp.opponent_of(v_sess.id, v_players[1]) IS DISTINCT FROM v_players[2] THEN
        RAISE EXCEPTION 'the swap did not put player 2 across from player 1';
    END IF;
    IF pg_temp.opponent_of(v_sess.id, v_players[3]) IS DISTINCT FROM v_players[4] THEN
        RAISE EXCEPTION 'the displaced player should have taken the other slot';
    END IF;
    RAISE NOTICE 'ok 3: a swap inside the round reaches the other arrangement';
END $$;

ROLLBACK;
