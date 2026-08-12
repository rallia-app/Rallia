-- ============================================
-- Tournaments — pool_knockout: tournament_matches.score is player1-first
-- ============================================
-- Four sites disagreed about what the score string means. The app's score
-- sheet serializes it player1-first, PoolsSection prints it raw beside
-- "player1 vs player2", but tournament_pool_standings parsed it winner-first
-- and lt_propagate_match_result_to_bracket copied a linked match's
-- team1-team2 verbatim. Two consequences:
--
--   1. Sets and games landed on the loser for every game the player2 side
--      won, so the set and game RATIOS were inverted. Those ratios are the
--      §8 tie-breakers that decide who qualifies and how the bracket is
--      seeded, so this could change qualification, not just the display.
--   2. A linked game rendered as a loss for its winner whenever the bracket's
--      player1 happened to sit on the match's team 2.
--
-- Neither showed up before because every fixture stored the score
-- winner-first, which is what the old parser expected, and the three linked
-- fixtures all happened to have player1 on team 1.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_score_orientation_test.sql
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

-- 1. The score text path: the left number of each set belongs to player1.
DO $$
DECLARE
    v_admin uuid;
    v_sport uuid;
    v_ps    uuid[];
    v_t     uuid;
    v_regs  uuid[] := '{}';
    v_reg   uuid;
    v_p     uuid;
    r       record;
BEGIN
    SELECT id INTO v_admin FROM admin LIMIT 1;
    SELECT s.id INTO v_sport FROM sport s WHERE s.name = 'tennis';
    SELECT array_agg(x.player_id) INTO v_ps
      FROM (SELECT ps.player_id FROM player_sport ps
             WHERE ps.sport_id = v_sport AND ps.is_active AND ps.player_id <> v_admin
             LIMIT 4) x;

    INSERT INTO tournaments (name, sport_id, max_participants, bracket_type, pool_size,
                             qualifiers_per_pool, start_date, end_date, status,
                             organizer_id, visibility)
    VALUES ('[TEST-ORIENT] pool', v_sport, 8, 'pool_knockout', 4, 2,
            now() + interval '2 days', now() + interval '9 days', 'in_progress',
            v_admin, 'public')
    RETURNING id INTO v_t;

    FOREACH v_p IN ARRAY v_ps LOOP
        INSERT INTO tournament_registrations (tournament_id, user_id, status)
        VALUES (v_t, v_p, 'registered') RETURNING id INTO v_reg;
        v_regs := v_regs || v_reg;
    END LOOP;

    -- Game 1: the player2 slot wins in straight sets, stored player1-first,
    -- exactly what TournamentRecordScoreSheet writes.
    INSERT INTO tournament_matches (tournament_id, bracket_side, pool_number, round_number,
                                    match_position, player1_registration_id,
                                    player2_registration_id, winner_registration_id,
                                    score, status)
    VALUES (v_t, 'pool', 1, 1, 1, v_regs[1], v_regs[2], v_regs[2], '3-6 4-6', 'completed'),
           (v_t, 'pool', 1, 1, 2, v_regs[3], v_regs[4], v_regs[3], '6-1 6-1', 'completed');

    PERFORM pg_temp.as_user(v_admin);

    FOR r IN SELECT registration_id, sets_won, sets_lost, games_won, games_lost
               FROM tournament_pool_standings(v_t)
              WHERE registration_id IN (v_regs[1], v_regs[2])
    LOOP
        IF r.registration_id = v_regs[2] THEN
            IF (r.sets_won, r.sets_lost, r.games_won, r.games_lost) <> (2, 0, 12, 7) THEN
                RAISE EXCEPTION 'winner in the player2 slot: sets %-% games %-%, expected 2-0 and 12-7',
                    r.sets_won, r.sets_lost, r.games_won, r.games_lost;
            END IF;
        ELSE
            IF (r.sets_won, r.sets_lost, r.games_won, r.games_lost) <> (0, 2, 7, 12) THEN
                RAISE EXCEPTION 'loser in the player1 slot: sets %-% games %-%, expected 0-2 and 7-12',
                    r.sets_won, r.sets_lost, r.games_won, r.games_lost;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'PASS: score text is read player1-first, not winner-first';
END;
$$;

-- 2. The bridge: a linked match whose team 1 is the bracket's PLAYER2 must
--    still be stored player1-first.
DO $$
DECLARE
    v_admin uuid;
    v_sport uuid;
    v_ps    uuid[];
    v_t     uuid;
    v_r1    uuid;
    v_r2    uuid;
    v_tm    uuid;
    v_match uuid;
    v_mr    uuid;
    v_score text;
    v_win   uuid;
BEGIN
    SELECT id INTO v_admin FROM admin LIMIT 1;
    SELECT s.id INTO v_sport FROM sport s WHERE s.name = 'tennis';
    SELECT array_agg(x.player_id) INTO v_ps
      FROM (SELECT ps.player_id FROM player_sport ps
             WHERE ps.sport_id = v_sport AND ps.is_active AND ps.player_id <> v_admin
             LIMIT 2) x;

    INSERT INTO tournaments (name, sport_id, max_participants, bracket_type, pool_size,
                             qualifiers_per_pool, start_date, end_date, status,
                             organizer_id, visibility)
    VALUES ('[TEST-ORIENT] bridge', v_sport, 8, 'pool_knockout', 4, 2,
            now() + interval '2 days', now() + interval '9 days', 'in_progress',
            v_admin, 'public')
    RETURNING id INTO v_t;

    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (v_t, v_ps[1], 'registered') RETURNING id INTO v_r1;
    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (v_t, v_ps[2], 'registered') RETURNING id INTO v_r2;

    INSERT INTO tournament_matches (tournament_id, bracket_side, pool_number, round_number,
                                    match_position, player1_registration_id,
                                    player2_registration_id, status)
    VALUES (v_t, 'pool', 1, 1, 1, v_r1, v_r2, 'pending')
    RETURNING id INTO v_tm;

    -- The match puts the bracket's PLAYER2 on team 1, the inversion that used
    -- to be copied straight through.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format)
    VALUES (v_sport, v_ps[2], (now() - interval '1 day')::date, '19:00', '20:30', 'singles')
    RETURNING id INTO v_match;
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_match, v_ps[2], 1, 'joined'), (v_match, v_ps[1], 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE SET team_number = EXCLUDED.team_number;

    UPDATE tournament_matches SET match_id = v_match WHERE id = v_tm;

    -- Team 1 (bracket player2) wins 6-3 6-4. Model the real order: the result
    -- and its sets land unverified, then the opponent confirms, and the
    -- lt_match_result_propagation trigger does the work. Inserting an already
    -- verified result first fires the trigger while match_set is still empty,
    -- which completes the bracket row with a NULL score.
    INSERT INTO match_result (match_id, winning_team, team1_score, team2_score,
                              submitted_by, is_verified)
    VALUES (v_match, 1, 2, 0, v_ps[2], false)
    RETURNING id INTO v_mr;
    INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (v_mr, 1, 6, 3), (v_mr, 2, 6, 4);

    UPDATE match_result SET is_verified = true, confirmed_by = v_ps[1], verified_at = now()
     WHERE id = v_mr;

    SELECT score, winner_registration_id INTO v_score, v_win
      FROM tournament_matches WHERE id = v_tm;

    IF v_win IS DISTINCT FROM v_r2 THEN
        RAISE EXCEPTION 'bridge picked the wrong winner';
    END IF;
    -- player1 lost, so player1-first storage must read 3-6 4-6.
    IF v_score IS DISTINCT FROM '3-6 4-6' THEN
        RAISE EXCEPTION 'bridge stored %, expected "3-6 4-6" (player1 first)', coalesce('"'||v_score||'"','NULL');
    END IF;

    RAISE NOTICE 'PASS: the bridge orients a linked score onto the player1 slot';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'tournament_pool_score_orientation_test: ALL PASS'; END; $$;

ROLLBACK;
