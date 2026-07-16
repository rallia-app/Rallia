-- ============================================
-- Tournament ranking ("Points Rallia") — award flow test
-- ============================================
-- Exercises award_tournament_ranking_points end to end through the real
-- tournament flow (create → register → bracket → play out → auto-award via the
-- completion trigger), then asserts the ledger.
--
-- Run against a seeded local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_ranking_award_test.sql
--
-- One transaction, ROLLBACK at the end — safe to re-run.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Full 8-entry bracket (no byes) → regional tier + zero-win floor.
--    The four round-1 losers won zero real matches, so they must land on
--    'participated' (20 pts), NOT 'quarterfinal' (90 pts).
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_match   tournament_matches;
    v_guard   integer := 0;
    v_count   integer;
    v_champ   uuid;
    v_season  text;
    v_total   integer;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 8) s;
    ASSERT array_length(v_players, 1) = 8, 'need 8 tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Ranking Cup 8', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open'
    );
    v_tid := v_t.id; v_ver := v_t.version;

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    -- All 8 register (organizer is auto-registered as participant on create in
    -- some flows; register any not yet present).
    FOR i IN 1..8 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        IF NOT EXISTS (SELECT 1 FROM tournament_registrations
                        WHERE tournament_id = v_tid AND user_id = v_players[i]
                          AND status = 'registered') THEN
            PERFORM tournament_register(v_tid);
        END IF;
    END LOOP;

    SELECT count(*) INTO v_count FROM tournament_registrations
     WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT v_count = 8, 'expected 8 registered, got ' || v_count;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    -- No byes: 8 real entries → round 1 has 4 real matches.
    SELECT count(*) INTO v_count FROM tournament_matches
     WHERE tournament_id = v_tid AND round_number = 1
       AND player1_is_bye = false AND player2_is_bye = false;
    ASSERT v_count = 4, 'expected 4 real R1 matches, got ' || v_count;

    -- Play out: player1 always wins.
    LOOP
        v_guard := v_guard + 1;
        ASSERT v_guard < 50, 'override loop did not converge';
        SELECT * INTO v_match FROM tournament_matches
         WHERE tournament_id = v_tid AND status = 'pending'
           AND player1_is_bye = false AND player2_is_bye = false
           AND player1_registration_id IS NOT NULL
           AND player2_registration_id IS NOT NULL
         ORDER BY round_number, match_position LIMIT 1;
        EXIT WHEN v_match.id IS NULL;
        PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
    END LOOP;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tid;
    ASSERT v_t.status = 'completed', 'expected completed, got ' || v_t.status;
    ASSERT v_t.completed_at IS NOT NULL, 'completed_at not stamped';

    -- Trigger should have awarded automatically.
    SELECT count(*) INTO v_count FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_count = 8, 'expected 8 ledger rows, got ' || v_count;

    -- Season resolved to the one containing completed_at.
    SELECT rs.code INTO v_season
      FROM tournament_ranking_points trp
      JOIN ranking_season rs ON rs.id = trp.season_id
     WHERE trp.tournament_id = v_tid LIMIT 1;
    ASSERT v_season IS NOT NULL, 'season not resolved';

    -- Tier: n=8 → regional (< 16 so never vedette regardless of strength).
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND tier <> 'regional';
    ASSERT v_count = 0, 'expected all rows regional tier';

    -- Placement distribution — the zero-win floor is the load-bearing assertion.
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_count = 1, 'expected 1 champion, got ' || v_count;
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'finalist';
    ASSERT v_count = 1, 'expected 1 finalist, got ' || v_count;
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'semifinal';
    ASSERT v_count = 2, 'expected 2 semifinalists, got ' || v_count;
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'quarterfinal';
    ASSERT v_count = 0, 'ZERO-WIN FLOOR: expected 0 quarterfinal in a full 8-bracket, got ' || v_count;
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'participated';
    ASSERT v_count = 4, 'expected 4 participated (R1 losers), got ' || v_count;

    -- Points: 500 + 300 + 2*180 + 4*20 = 1240.
    SELECT sum(points) INTO v_total FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_total = 1240, 'expected total 1240 points, got ' || v_total;

    SELECT points INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_count = 500, 'champion should have 500 pts, got ' || v_count;

    -- Idempotent recompute: rerun directly, nothing changes.
    PERFORM award_tournament_ranking_points(v_tid);
    SELECT count(*) INTO v_count FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_count = 8, 'recompute changed row count, got ' || v_count;
    SELECT sum(points) INTO v_total FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_total = 1240, 'recompute changed total, got ' || v_total;

    RAISE NOTICE 'PASS 1: 8-entry regional bracket — zero-win floor + points + idempotency';
END $$;

-- --------------------------------------------------------------------------
-- 2. 4-entry bracket → local tier (n < 8): participation-only floor.
--    Champion keeps the 'champion' label but earns participation points
--    (20 * 0.5 = 10), same as everyone else.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_match   tournament_matches;
    v_guard   integer := 0;
    v_count   integer;
    i         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 4) s;
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Ranking Cup 4', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open'
    );
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    FOR i IN 1..4 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        IF NOT EXISTS (SELECT 1 FROM tournament_registrations
                        WHERE tournament_id = v_tid AND user_id = v_players[i]
                          AND status = 'registered') THEN
            PERFORM tournament_register(v_tid);
        END IF;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    LOOP
        v_guard := v_guard + 1;
        ASSERT v_guard < 50, 'override loop did not converge';
        SELECT * INTO v_match FROM tournament_matches
         WHERE tournament_id = v_tid AND status = 'pending'
           AND player1_is_bye = false AND player2_is_bye = false
           AND player1_registration_id IS NOT NULL
           AND player2_registration_id IS NOT NULL
         ORDER BY round_number, match_position LIMIT 1;
        EXIT WHEN v_match.id IS NULL;
        PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-0 6-0');
    END LOOP;

    ASSERT (SELECT status FROM tournaments WHERE id = v_tid) = 'completed', 'expected completed';

    SELECT count(*) INTO v_count FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_count = 4, 'expected 4 ledger rows, got ' || v_count;

    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND tier <> 'local';
    ASSERT v_count = 0, 'expected all rows local tier';

    -- Every player earns the participation floor: 20 * 0.5 = 10.
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND points <> 10;
    ASSERT v_count = 0, 'expected all points = 10 (local floor), found ' || v_count || ' rows differing';

    -- The champion label is still recorded even though points are floored.
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion';
    ASSERT v_count = 1, 'expected champion label preserved, got ' || v_count;

    RAISE NOTICE 'PASS 2: 4-entry local bracket — participation-only floor (10 pts), champion label kept';
END $$;

-- --------------------------------------------------------------------------
-- 3. Doubles: 8 team entries (16 players) in a full 8-bracket → regional.
--    Each team is ONE registration (captain + partner_user_id). Both partners
--    must get FULL, IDENTICAL points (not split), and the zero-win floor still
--    applies at the team level.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_tid     uuid;
    v_ver     integer;
    v_match   tournament_matches;
    v_guard   integer := 0;
    v_count   integer;
    v_total   integer;
    v_bad     integer;
    k         integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 16) s;
    ASSERT array_length(v_players, 1) = 16, 'need 16 tennis players for 8 doubles teams';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Ranking Doubles 8', p_sport_id => v_sport,
        p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days',
        p_end_date   => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'doubles'
    );
    v_tid := v_t.id; v_ver := v_t.version;
    ASSERT v_t.entry_format = 'doubles', 'expected doubles tournament';

    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver);
    v_ver := v_t.version;

    -- 8 teams: captain = players[k], partner = players[8+k].
    FOR k IN 1..8 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[k]::text)::text, true);
        IF NOT EXISTS (SELECT 1 FROM tournament_registrations
                        WHERE tournament_id = v_tid AND user_id = v_players[k]
                          AND status = 'registered') THEN
            PERFORM tournament_register(v_tid, v_players[8 + k]);
        END IF;
    END LOOP;

    SELECT count(*) INTO v_count FROM tournament_registrations
     WHERE tournament_id = v_tid AND status = 'registered';
    ASSERT v_count = 8, 'expected 8 team entries, got ' || v_count;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver);
    v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    LOOP
        v_guard := v_guard + 1;
        ASSERT v_guard < 50, 'override loop did not converge';
        SELECT * INTO v_match FROM tournament_matches
         WHERE tournament_id = v_tid AND status = 'pending'
           AND player1_is_bye = false AND player2_is_bye = false
           AND player1_registration_id IS NOT NULL
           AND player2_registration_id IS NOT NULL
         ORDER BY round_number, match_position LIMIT 1;
        EXIT WHEN v_match.id IS NULL;
        PERFORM tournament_override_score(v_match.id, v_match.player1_registration_id, '6-1 6-2');
    END LOOP;

    ASSERT (SELECT status FROM tournaments WHERE id = v_tid) = 'completed', 'expected completed';

    -- 8 teams * 2 players = 16 ledger rows.
    SELECT count(*) INTO v_count FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_count = 16, 'expected 16 ledger rows (8 teams x 2), got ' || v_count;

    -- Both members of every team share placement AND points (full, not split).
    SELECT count(*) INTO v_bad FROM (
        SELECT registration_id
          FROM tournament_ranking_points
         WHERE tournament_id = v_tid
         GROUP BY registration_id
        HAVING count(DISTINCT points) <> 1 OR count(DISTINCT placement) <> 1 OR count(*) <> 2
    ) q;
    ASSERT v_bad = 0, 'each team must have 2 rows with identical points+placement, ' || v_bad || ' teams differ';

    -- Champion pair: 2 rows at 500 (full points each, not 250).
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'champion' AND points = 500;
    ASSERT v_count = 2, 'expected 2 champion rows at 500 pts, got ' || v_count;

    -- Zero-win floor holds at team level: no quarterfinal, 8 participated rows.
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'quarterfinal';
    ASSERT v_count = 0, 'ZERO-WIN FLOOR (doubles): expected 0 quarterfinal, got ' || v_count;
    SELECT count(*) INTO v_count FROM tournament_ranking_points
     WHERE tournament_id = v_tid AND placement = 'participated';
    ASSERT v_count = 8, 'expected 8 participated rows (4 teams x 2), got ' || v_count;

    -- Total = 1240 per player-set * 2 = 2480.
    SELECT sum(points) INTO v_total FROM tournament_ranking_points WHERE tournament_id = v_tid;
    ASSERT v_total = 2480, 'expected total 2480 points, got ' || v_total;

    RAISE NOTICE 'PASS 3: doubles 8-team bracket — full (unsplit) points per partner + zero-win floor';
END $$;

-- --------------------------------------------------------------------------
-- 4. Read path — best-8 cap, ordering, profile join, pagination, my-ranking.
--    Synthetic ledger rows (a direct completed-tournament INSERT does not fire
--    the AFTER-UPDATE award trigger, so this seeds cleanly). Runs against
--    pickleball with a clean slate, isolated from the tennis rows in 1–3.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_season  uuid;
    v_players uuid[];
    v_org     uuid;
    v_p1 uuid; v_p2 uuid; v_p3 uuid;
    v_tid uuid; v_rid uuid;
    v_row record;
    v_points int; v_events int; v_rank int;
    v_name text; v_count int;
BEGIN
    SELECT id INTO v_sport  FROM sport WHERE name = 'pickleball';
    SELECT id INTO v_season FROM ranking_season WHERE now() >= starts_at AND now() < ends_at;
    DELETE FROM tournament_ranking_points WHERE sport_id = v_sport AND season_id = v_season;
    SELECT array_agg(id) INTO v_players
      FROM (SELECT id FROM profile ORDER BY id LIMIT 3) s;
    v_org := v_players[1]; v_p1 := v_players[1]; v_p2 := v_players[2]; v_p3 := v_players[3];

    -- P1: 9 results (best-8 must drop the 10) → 500+300+180+90*5 = 1430, events 9.
    -- P2: 500 over 2 events. P3: 400 over 1.
    FOR v_row IN
        SELECT * FROM (VALUES
            (v_p1,500),(v_p1,300),(v_p1,180),(v_p1,90),(v_p1,90),
            (v_p1,90),(v_p1,90),(v_p1,90),(v_p1,10),
            (v_p2,300),(v_p2,200),
            (v_p3,400)
        ) AS t(pid, pts)
    LOOP
        INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date, organizer_id, status, completed_at)
        VALUES ('synthetic', v_sport, 8, now(), now(), v_org, 'completed', now())
        RETURNING id INTO v_tid;
        INSERT INTO tournament_registrations (tournament_id, user_id)
        VALUES (v_tid, v_row.pid) RETURNING id INTO v_rid;
        INSERT INTO tournament_ranking_points
            (season_id, tournament_id, registration_id, user_id, sport_id, level_bucket, placement, tier, points)
        VALUES (v_season, v_tid, v_rid, v_row.pid, v_sport, 'intermediate', 'participated', 'regional', v_row.pts);
    END LOOP;

    -- best-8 cap + events_played
    SELECT points, events_played, rank INTO v_points, v_events, v_rank
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 25, 0) WHERE user_id = v_p1;
    ASSERT v_points = 1430, 'best-8: expected 1430 for P1, got ' || v_points;
    ASSERT v_events = 9,    'expected events_played 9 for P1, got ' || v_events;
    ASSERT v_rank = 1,      'expected P1 rank 1, got ' || v_rank;

    SELECT points, events_played, rank INTO v_points, v_events, v_rank
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 25, 0) WHERE user_id = v_p2;
    ASSERT v_points = 500 AND v_events = 2 AND v_rank = 2,
        'P2 expected 500/2/#2, got ' || v_points || '/' || v_events || '/' || v_rank;

    SELECT rank INTO v_rank
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 25, 0) WHERE user_id = v_p3;
    ASSERT v_rank = 3, 'expected P3 rank 3, got ' || v_rank;

    -- profile join renders a name
    SELECT full_name INTO v_name
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 25, 0) WHERE user_id = v_p1;
    ASSERT v_name IS NOT NULL AND length(v_name) > 0, 'expected a full_name for P1';

    -- pagination: limit 1 offset 1 → the rank-2 player only
    SELECT count(*) INTO v_count
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 1, 1);
    ASSERT v_count = 1, 'pagination expected 1 row, got ' || v_count;
    SELECT rank INTO v_rank
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 1, 1) LIMIT 1;
    ASSERT v_rank = 2, 'pagination offset 1 should surface rank 2, got ' || v_rank;

    -- my-ranking (auth.uid() = P1). Bucket (live-rating derived) is covered in
    -- block 5 where ratings are set up.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p1::text)::text, true);
    SELECT points, rank INTO v_points, v_rank
      FROM get_my_tournament_ranking(NULL) WHERE sport_id = v_sport;
    ASSERT v_points = 1430 AND v_rank = 1, 'my-ranking expected 1430/#1, got ' || v_points || '/' || v_rank;

    RAISE NOTICE 'PASS 4: read path — best-8 cap, ordering, profile join, pagination, my-ranking';
END $$;

-- --------------------------------------------------------------------------
-- 5. Level filter — selects players by their CURRENT active rating's bucket
--    (not the ledger snapshot); all their rows still count. Unrated players are
--    excluded from any filtered view. Also asserts get_my_tournament_ranking's
--    bucket matches. Uses pickleball to stay isolated from the tennis rows
--    above; replica role bypasses the active-rating validator trigger so any
--    rating_score can stand in.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport  uuid;
    v_season uuid;
    v_org    uuid;
    v_pa uuid; v_pb uuid; v_pc uuid;
    v_rs_int uuid; v_rs_adv uuid; v_prs uuid;
    v_tid uuid; v_rid uuid;
    v_count int; v_points int; v_bucket text;
BEGIN
    SET LOCAL session_replication_role = replica;  -- bypass active-rating validator

    SELECT id INTO v_sport  FROM sport WHERE name = 'pickleball';
    SELECT id INTO v_season FROM ranking_season WHERE now() >= starts_at AND now() < ends_at;
    DELETE FROM tournament_ranking_points WHERE sport_id = v_sport AND season_id = v_season;
    SELECT id INTO v_org FROM profile ORDER BY id LIMIT 1;
    SELECT id INTO v_pa FROM profile ORDER BY id OFFSET 4 LIMIT 1;
    SELECT id INTO v_pb FROM profile ORDER BY id OFFSET 5 LIMIT 1;
    SELECT id INTO v_pc FROM profile ORDER BY id OFFSET 6 LIMIT 1;

    SELECT id INTO v_rs_int FROM rating_score WHERE skill_level = 'intermediate' LIMIT 1;
    SELECT id INTO v_rs_adv FROM rating_score WHERE skill_level = 'advanced' LIMIT 1;
    ASSERT v_rs_int IS NOT NULL AND v_rs_adv IS NOT NULL, 'need seed rating_scores';

    -- Live active ratings: P_A intermediate, P_B advanced, P_C none.
    INSERT INTO player_rating_score (player_id, rating_score_id) VALUES (v_pa, v_rs_int)
      ON CONFLICT (player_id, rating_score_id) DO UPDATE SET updated_at = now() RETURNING id INTO v_prs;
    INSERT INTO player_sport (player_id, sport_id, active_rating_score_id) VALUES (v_pa, v_sport, v_prs)
      ON CONFLICT (player_id, sport_id) DO UPDATE SET active_rating_score_id = EXCLUDED.active_rating_score_id;

    INSERT INTO player_rating_score (player_id, rating_score_id) VALUES (v_pb, v_rs_adv)
      ON CONFLICT (player_id, rating_score_id) DO UPDATE SET updated_at = now() RETURNING id INTO v_prs;
    INSERT INTO player_sport (player_id, sport_id, active_rating_score_id) VALUES (v_pb, v_sport, v_prs)
      ON CONFLICT (player_id, sport_id) DO UPDATE SET active_rating_score_id = EXCLUDED.active_rating_score_id;

    UPDATE player_sport SET active_rating_score_id = NULL WHERE player_id = v_pc AND sport_id = v_sport;

    -- Ledger rows (level_bucket column is now history-only, not read by filters):
    -- P_A two rows (200 total), P_B one, P_C one.
    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date, organizer_id, status, completed_at)
      VALUES ('lf', v_sport, 8, now(), now(), v_org, 'completed', now()) RETURNING id INTO v_tid;
    INSERT INTO tournament_registrations (tournament_id, user_id) VALUES (v_tid, v_pa) RETURNING id INTO v_rid;
    INSERT INTO tournament_ranking_points (season_id, tournament_id, registration_id, user_id, sport_id, level_bucket, placement, tier, points)
      VALUES (v_season, v_tid, v_rid, v_pa, v_sport, 'intermediate', 'participated', 'regional', 100);

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date, organizer_id, status, completed_at)
      VALUES ('lf', v_sport, 8, now(), now(), v_org, 'completed', now()) RETURNING id INTO v_tid;
    INSERT INTO tournament_registrations (tournament_id, user_id) VALUES (v_tid, v_pa) RETURNING id INTO v_rid;
    INSERT INTO tournament_ranking_points (season_id, tournament_id, registration_id, user_id, sport_id, level_bucket, placement, tier, points)
      VALUES (v_season, v_tid, v_rid, v_pa, v_sport, 'intermediate', 'participated', 'regional', 100);

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date, organizer_id, status, completed_at)
      VALUES ('lf', v_sport, 8, now(), now(), v_org, 'completed', now()) RETURNING id INTO v_tid;
    INSERT INTO tournament_registrations (tournament_id, user_id) VALUES (v_tid, v_pb) RETURNING id INTO v_rid;
    INSERT INTO tournament_ranking_points (season_id, tournament_id, registration_id, user_id, sport_id, level_bucket, placement, tier, points)
      VALUES (v_season, v_tid, v_rid, v_pb, v_sport, 'advanced', 'participated', 'regional', 100);

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date, organizer_id, status, completed_at)
      VALUES ('lf', v_sport, 8, now(), now(), v_org, 'completed', now()) RETURNING id INTO v_tid;
    INSERT INTO tournament_registrations (tournament_id, user_id) VALUES (v_tid, v_pc) RETURNING id INTO v_rid;
    INSERT INTO tournament_ranking_points (season_id, tournament_id, registration_id, user_id, sport_id, level_bucket, placement, tier, points)
      VALUES (v_season, v_tid, v_rid, v_pc, v_sport, NULL, 'participated', 'regional', 100);

    -- No filter → all three appear.
    SELECT count(*) INTO v_count FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 25, 0)
     WHERE user_id IN (v_pa, v_pb, v_pc);
    ASSERT v_count = 3, 'unfiltered board expected 3 players, got ' || v_count;

    -- Filter 'intermediate' → only P_A (live rating), BOTH rows counted (200).
    SELECT count(*) INTO v_count FROM get_tournament_leaderboard(v_sport, NULL, 'intermediate', NULL, 25, 0);
    ASSERT v_count = 1, 'intermediate filter expected 1 player, got ' || v_count;
    SELECT points INTO v_points FROM get_tournament_leaderboard(v_sport, NULL, 'intermediate', NULL, 25, 0) WHERE user_id = v_pa;
    ASSERT v_points = 200, 'level filter must count ALL of P_A''s rows (200), got ' || v_points;

    -- Filter 'beginner' → empty: nobody's active rating is beginner.
    SELECT count(*) INTO v_count FROM get_tournament_leaderboard(v_sport, NULL, 'beginner', NULL, 25, 0);
    ASSERT v_count = 0, 'beginner filter should be empty (no beginner ratings), got ' || v_count;

    -- Filter 'advanced' → only P_B; unrated P_C never appears in a filtered view.
    SELECT count(*) INTO v_count FROM get_tournament_leaderboard(v_sport, NULL, 'advanced', NULL, 25, 0);
    ASSERT v_count = 1, 'advanced filter expected 1 player, got ' || v_count;

    -- get_my_tournament_ranking bucket = live rating bucket (P_A → intermediate).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pa::text)::text, true);
    SELECT level_bucket INTO v_bucket FROM get_my_tournament_ranking(NULL) WHERE sport_id = v_sport;
    ASSERT v_bucket = 'intermediate', 'my-ranking bucket should be live-rating intermediate, got ' || coalesce(v_bucket, 'NULL');

    RAISE NOTICE 'PASS 5: level filter — live-rating player selection, all rows counted, unrated excluded, my-bucket matches';
END $$;

-- --------------------------------------------------------------------------
-- 6. Exact-rating filter — selects players by CURRENT active rating_score id;
--    all their rows count. Uses the tennis board built by blocks 1-3 (seeded
--    players all carry active ratings).
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport   uuid;
    v_rsid    uuid;
    v_player  uuid;
    v_total   int;
    v_filtered int;
    v_bad     int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    -- A rating_score actually held (as active) by someone on the board.
    SELECT prs.rating_score_id, ps.player_id INTO v_rsid, v_player
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE ps.sport_id = v_sport
       AND ps.player_id IN (SELECT user_id FROM tournament_ranking_points WHERE sport_id = v_sport)
     LIMIT 1;
    ASSERT v_rsid IS NOT NULL, 'need a board player with an active rating';

    SELECT count(*) INTO v_total
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, NULL, 100, 0);
    SELECT count(*) INTO v_filtered
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, v_rsid, 100, 0);
    ASSERT v_filtered >= 1 AND v_filtered <= v_total,
        'rating filter expected 1..' || v_total || ' rows, got ' || v_filtered;

    -- The anchor player appears, and every returned player holds that rating.
    ASSERT EXISTS (
        SELECT 1 FROM get_tournament_leaderboard(v_sport, NULL, NULL, v_rsid, 100, 0)
         WHERE user_id = v_player
    ), 'anchor player missing from their own rating-filtered board';

    SELECT count(*) INTO v_bad
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, v_rsid, 100, 0) b
     WHERE NOT EXISTS (
        SELECT 1 FROM player_sport ps
          JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
         WHERE ps.player_id = b.user_id AND ps.sport_id = v_sport
           AND prs.rating_score_id = v_rsid
     );
    ASSERT v_bad = 0, 'rating-filtered board contains ' || v_bad || ' players with a different rating';

    -- Nonexistent rating → empty board.
    SELECT count(*) INTO v_filtered
      FROM get_tournament_leaderboard(v_sport, NULL, NULL, gen_random_uuid(), 100, 0);
    ASSERT v_filtered = 0, 'random rating id should filter to empty, got ' || v_filtered;

    RAISE NOTICE 'PASS 6: exact-rating filter — active-rating-id player selection, empty for unknown rating';
END $$;

ROLLBACK;
