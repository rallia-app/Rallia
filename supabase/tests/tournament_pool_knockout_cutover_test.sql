-- ============================================
-- Tournaments — pool_knockout F3: cut-over + full run to champion
-- ============================================
-- One 8-player pool_knockout tournament (2 pools of 4, 2 qualifiers each)
-- played to the end:
--   * cut-over guards (POOLS_NOT_COMPLETE before pools settle, then
--     KNOCKOUT_ALREADY_GENERATED after);
--   * knockout shape: 4 qualifiers → draw of 4, no byes, semifinals wire
--     into a final; same-pool players land in opposite semifinals;
--   * pool non-qualifiers excluded from the tree;
--   * knockout played through override → advancement completes the
--     tournament and crowns the champion;
--   * award: pool-stage exits earn 'participated' ranking points (certified
--     organizer), qualifiers place normally.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_knockout_cutover_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.settle_pool(p_t uuid, p_winner uuid, p_loser uuid, p_score text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_tm  tournament_matches;
    v_win uuid;
BEGIN
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournament_registrations r1 ON r1.id = tm.player1_registration_id
      JOIN tournament_registrations r2 ON r2.id = tm.player2_registration_id
     WHERE tm.tournament_id = p_t AND tm.bracket_side = 'pool'
       AND ((r1.user_id, r2.user_id) = (p_winner, p_loser)
         OR (r1.user_id, r2.user_id) = (p_loser, p_winner));
    SELECT id INTO v_win FROM tournament_registrations
     WHERE tournament_id = p_t AND user_id = p_winner;
    PERFORM public.tournament_override_score(v_tm.id, v_win, p_score);
END;
$$;

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_seeds     uuid[];
    p1 uuid[]; p2 uuid[];
    v_cnt       integer;
    v_err       text;
    v_semi      tournament_matches;
    v_final     tournament_matches;
    v_champ_reg uuid;
    v_reg       uuid;
    v_same_semi integer;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[9];

    -- Certified organizer so award runs for real.
    UPDATE player SET is_certified_organizer = true WHERE id = v_organizer;

    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Cutover', (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout');
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

    -- Cut-over refused while pool matches are unsettled.
    BEGIN
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_generate_knockout(v_t.id, v_ver);
        RAISE EXCEPTION 'expected POOLS_NOT_COMPLETE';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'POOLS_NOT_COMPLETE' THEN RAISE; END IF;
    END;

    v_seeds := ARRAY(
        SELECT tr.user_id FROM tournament_registrations tr
         WHERE tr.tournament_id = v_t.id
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);
    p1 := ARRAY(
        SELECT ps.user_id FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.pool_number = 1 ORDER BY array_position(v_seeds, ps.user_id));
    p2 := ARRAY(
        SELECT ps.user_id FROM public.tournament_pool_standings(v_t.id) ps
         WHERE ps.pool_number = 2 ORDER BY array_position(v_seeds, ps.user_id));

    -- Deterministic pools: seed order wins everywhere.
    FOR i IN 1..3 LOOP
        FOR j IN (i+1)..4 LOOP
            PERFORM pg_temp.settle_pool(v_t.id, p1[i], p1[j], '6-2 6-2');
            PERFORM pg_temp.settle_pool(v_t.id, p2[i], p2[j], '6-3 6-3');
        END LOOP;
    END LOOP;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.tournament_generate_knockout(v_t.id, v_ver);
    -- 4 qualifiers → draw of 4: 2 semis + 1 final = 3 rows, no byes.
    IF v_cnt <> 3 THEN
        RAISE EXCEPTION 'knockout has % rows, expected 3', v_cnt;
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = v_t.id AND bracket_side = 'main'
           AND (player1_is_bye OR player2_is_bye)
    ) THEN
        RAISE EXCEPTION 'unexpected byes in an exact-fit draw';
    END IF;

    -- Non-qualifiers (pool ranks 3-4) are absent from the tree.
    IF EXISTS (
        SELECT 1 FROM tournament_matches tm
          JOIN tournament_registrations tr
            ON tr.id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'main'
           AND tr.user_id IN (p1[3], p1[4], p2[3], p2[4])
    ) THEN
        RAISE EXCEPTION 'non-qualifier present in the knockout';
    END IF;

    -- Same-pool separation: the two pool-1 qualifiers are in different semis.
    SELECT count(DISTINCT tm.id) INTO v_same_semi
      FROM tournament_matches tm
      JOIN tournament_registrations tr
        ON tr.id IN (tm.player1_registration_id, tm.player2_registration_id)
     WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'main'
       AND tm.round_number = 1
       AND tr.user_id IN (p1[1], p1[2]);
    IF v_same_semi <> 2 THEN
        RAISE EXCEPTION 'same-pool qualifiers share a semifinal';
    END IF;

    -- Idempotency.
    BEGIN
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_generate_knockout(v_t.id, v_ver);
        RAISE EXCEPTION 'expected KNOCKOUT_ALREADY_GENERATED';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'KNOCKOUT_ALREADY_GENERATED' THEN RAISE; END IF;
    END;

    -- Play the tree: player1 side wins every match.
    FOR v_semi IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1
         ORDER BY match_position
    LOOP
        PERFORM public.tournament_override_score(
            v_semi.id, v_semi.player1_registration_id, '6-4 6-4');
    END LOOP;

    SELECT * INTO v_final FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 2;
    IF v_final.player1_registration_id IS NULL OR v_final.player2_registration_id IS NULL THEN
        RAISE EXCEPTION 'final not populated by advancement';
    END IF;
    PERFORM public.tournament_override_score(
        v_final.id, v_final.player1_registration_id, '7-5 7-5');

    IF (SELECT status FROM tournaments WHERE id = v_t.id) <> 'completed' THEN
        RAISE EXCEPTION 'tournament not completed after the final';
    END IF;

    -- Award: everyone gets rows; the four pool-stage exits are 'participated'.
    UPDATE tournaments SET completed_at = now() WHERE id = v_t.id AND completed_at IS NULL;
    PERFORM public.award_tournament_ranking_points(v_t.id);

    SELECT count(*) INTO v_cnt FROM tournament_ranking_points
     WHERE tournament_id = v_t.id;
    IF v_cnt <> 8 THEN
        RAISE EXCEPTION 'expected 8 ranking rows, got %', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM tournament_ranking_points trp
     WHERE trp.tournament_id = v_t.id
       AND trp.user_id IN (p1[3], p1[4], p2[3], p2[4])
       AND trp.placement = 'participated';
    IF v_cnt <> 4 THEN
        RAISE EXCEPTION 'pool exits misplaced: % participated of 4', v_cnt;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tournament_ranking_points trp
         WHERE trp.tournament_id = v_t.id AND trp.placement = 'champion'
    ) THEN
        RAISE EXCEPTION 'no champion row awarded';
    END IF;

    RAISE NOTICE 'tournament_pool_knockout_cutover_test: ALL PASS';
END;
$$;

ROLLBACK;
