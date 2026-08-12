-- ============================================
-- Leagues — session_matches.score is team_A-first
-- ============================================
-- The leagues twin of tournament_pool_score_orientation_test. Three sites
-- already agreed that the string is team_A-first: SessionRecordScoreSheet
-- serializes side 1 as team A, SessionDetail prints it raw between the team A
-- and team B names, and recalc_season_ranking hands lt_parse_score's a_sets and
-- a_games to team A's members. lt_propagate_match_result_to_session was the
-- odd one out: it copied the linked match's team1-team2 verbatim, and a match's
-- team numbering is unrelated to the pairing's a/b. A pairing whose team A sat
-- on the match's team 2 therefore stored the score reversed, which both reads
-- as the wrong side winning and feeds inverted sets and games into season
-- points and the standings tie-breakers.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_score_orientation_test.sql
-- ============================================

BEGIN;

DO $$
DECLARE
    v_admin  uuid;
    v_sport  uuid;
    v_ps     uuid[];
    v_league uuid;
    v_season uuid;
    v_sess   uuid;
    v_sm     uuid;
    v_match  uuid;
    v_mr     uuid;
    v_score  text;
    v_winner pairing_team;
    r_a      record;
    r_b      record;
BEGIN
    SELECT id INTO v_admin FROM admin LIMIT 1;
    SELECT s.id INTO v_sport FROM sport s WHERE s.name = 'tennis';
    SELECT array_agg(x.player_id) INTO v_ps
      FROM (SELECT ps.player_id FROM player_sport ps
             WHERE ps.sport_id = v_sport AND ps.is_active AND ps.player_id <> v_admin
             LIMIT 2) x;

    INSERT INTO leagues (name, sport_id, organizer_id)
    VALUES ('[TEST-ORIENT] league', v_sport, v_admin) RETURNING id INTO v_league;
    INSERT INTO seasons (league_id, name, start_date, end_date, status)
    VALUES (v_league, 'S1', (now() - interval '7 days')::date,
            (now() + interval '30 days')::date, 'open')
    RETURNING id INTO v_season;
    INSERT INTO season_members (season_id, user_id, status)
    VALUES (v_season, v_ps[1], 'enrolled'), (v_season, v_ps[2], 'enrolled');

    INSERT INTO sessions (season_id, name, scheduled_at, timezone, status)
    VALUES (v_season, 'W1', now() - interval '1 day', 'America/Toronto', 'published')
    RETURNING id INTO v_sess;

    -- Team A is players[1], team B is players[2].
    INSERT INTO session_matches (session_id, round_number, team_a_user_ids, team_b_user_ids, status)
    VALUES (v_sess, 1, ARRAY[v_ps[1]], ARRAY[v_ps[2]], 'pending')
    RETURNING id INTO v_sm;

    -- The match puts team B's player on team 1, the inversion that used to be
    -- copied straight through, and team 1 wins 6-3 6-4.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format)
    VALUES (v_sport, v_ps[2], (now() - interval '1 day')::date, '19:00', '20:30', 'singles')
    RETURNING id INTO v_match;
    INSERT INTO match_participant (match_id, player_id, team_number, status)
    VALUES (v_match, v_ps[2], 1, 'joined'), (v_match, v_ps[1], 2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE SET team_number = EXCLUDED.team_number;

    UPDATE session_matches SET match_id = v_match WHERE id = v_sm;

    -- Model the real order: the result and its sets land unverified, then the
    -- opponent confirms and the lt_match_result_propagation trigger does the
    -- work. Inserting an already verified result first fires the trigger while
    -- match_set is still empty, which settles the pairing with a NULL score.
    INSERT INTO match_result (match_id, winning_team, team1_score, team2_score,
                              submitted_by, is_verified)
    VALUES (v_match, 1, 2, 0, v_ps[2], false)
    RETURNING id INTO v_mr;
    INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (v_mr, 1, 6, 3), (v_mr, 2, 6, 4);

    UPDATE match_result SET is_verified = true, confirmed_by = v_ps[1], verified_at = now()
     WHERE id = v_mr;

    SELECT score, winner_team INTO v_score, v_winner FROM session_matches WHERE id = v_sm;

    IF v_winner IS DISTINCT FROM 'b' THEN
        RAISE EXCEPTION 'winner_team is %, expected b', v_winner;
    END IF;
    -- Team A lost, so team_A-first storage must read 3-6 4-6.
    IF v_score IS DISTINCT FROM '3-6 4-6' THEN
        RAISE EXCEPTION 'stored %, expected "3-6 4-6" (team A first)', coalesce('"'||v_score||'"','NULL');
    END IF;

    -- And the season ranking must credit the sets to the side that won them.
    -- The bridge calls recalc_season_ranking itself.
    SELECT sets_won, sets_lost, games_won, games_lost INTO r_a
      FROM season_rankings WHERE season_id = v_season AND user_id = v_ps[1];
    SELECT sets_won, sets_lost, games_won, games_lost INTO r_b
      FROM season_rankings WHERE season_id = v_season AND user_id = v_ps[2];

    IF (r_b.sets_won, r_b.sets_lost, r_b.games_won, r_b.games_lost) <> (2, 0, 12, 7) THEN
        RAISE EXCEPTION 'team B (the winner) ranked sets %-% games %-%, expected 2-0 and 12-7',
            r_b.sets_won, r_b.sets_lost, r_b.games_won, r_b.games_lost;
    END IF;
    IF (r_a.sets_won, r_a.sets_lost, r_a.games_won, r_a.games_lost) <> (0, 2, 7, 12) THEN
        RAISE EXCEPTION 'team A (the loser) ranked sets %-% games %-%, expected 0-2 and 7-12',
            r_a.sets_won, r_a.sets_lost, r_a.games_won, r_a.games_lost;
    END IF;

    RAISE NOTICE 'PASS: the session bridge orients a linked score onto team A, and the season ranking follows';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'session_score_orientation_test: ALL PASS'; END; $$;

ROLLBACK;
