-- ============================================
-- get_player_match_history — verified-score game history for a profile
-- ============================================
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/player_match_history_test.sql
-- ============================================

BEGIN;

-- Suppress match insert side-effect triggers (chat/push/etc.) during fixturing.
SET LOCAL session_replication_role = replica;

-- Deterministic fixture ids so the RLS-bypass block can reference the private match.
-- m1 (private, singles, competitive, verified, p1 wins, 2 sets)   -> newest, included
-- m2 (public, doubles, casual, verified, p1 loses, 3 sets)        -> included
-- m3 (singles, verified but DISPUTED)                             -> excluded
-- m4 (singles, NOT verified)                                      -> excluded
-- m5 (singles, verified but CANCELLED)                            -> excluded
-- m6 (pickleball, verified)                                       -> included only without sport filter
DO $$
DECLARE
  v_sport  uuid;
  v_pickle uuid;
  v_pl     uuid[];
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  m1 uuid := 'd1000000-0000-0000-0000-000000000001';
  m2 uuid := 'd1000000-0000-0000-0000-000000000002';
  m3 uuid := 'd1000000-0000-0000-0000-000000000003';
  m4 uuid := 'd1000000-0000-0000-0000-000000000004';
  m5 uuid := 'd1000000-0000-0000-0000-000000000005';
  m6 uuid := 'd1000000-0000-0000-0000-000000000006';
  r  uuid;
  v_count int;
  v_rec record;
BEGIN
  SELECT id INTO v_sport  FROM sport WHERE name = 'tennis';
  SELECT id INTO v_pickle FROM sport WHERE name = 'pickleball';
  SELECT array_agg(player_id) INTO v_pl FROM (
    SELECT player_id FROM player_sport
     WHERE sport_id = v_sport AND is_active = true ORDER BY player_id LIMIT 5) s;
  ASSERT array_length(v_pl, 1) = 5, 'need 5 active tennis players in seed';
  p1 := v_pl[1]; p2 := v_pl[2]; p3 := v_pl[3]; p4 := v_pl[4]; p5 := v_pl[5];

  -- M1: private singles, competitive, verified, p1 (team 1) wins 2-0, two sets.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format, visibility)
    VALUES (m1, v_sport, DATE '2026-06-10', TIME '10:00', TIME '11:00', p1, 'competitive', 'singles', 'private');
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
    VALUES (m1, p1, 1, true, 'joined'), (m1, p2, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m1, 1, 2, 0, true, false) RETURNING id INTO r;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (r, 1, 6, 3), (r, 2, 6, 4);

  -- M2: public doubles, casual, verified, p1 (team 1) loses, three sets.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format, visibility)
    VALUES (m2, v_sport, DATE '2026-06-05', TIME '18:00', TIME '19:30', p1, 'casual', 'doubles', 'public');
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status) VALUES
    (m2, p1, 1, true, 'joined'), (m2, p3, 1, false, 'joined'),
    (m2, p4, 2, false, 'joined'), (m2, p5, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m2, 2, 1, 2, true, false) RETURNING id INTO r;
  INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (r, 1, 4, 6), (r, 2, 6, 3), (r, 3, 5, 7);

  -- M3: verified but DISPUTED -> excluded.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format)
    VALUES (m3, v_sport, DATE '2026-06-08', TIME '09:00', TIME '10:00', p1, 'competitive', 'singles');
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
    VALUES (m3, p1, 1, true, 'joined'), (m3, p2, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m3, 1, 2, 0, true, true);

  -- M4: NOT verified -> excluded.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format)
    VALUES (m4, v_sport, DATE '2026-06-07', TIME '09:00', TIME '10:00', p1, 'competitive', 'singles');
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
    VALUES (m4, p1, 1, true, 'joined'), (m4, p2, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m4, 1, 2, 0, false, false);

  -- M5: verified but CANCELLED -> excluded.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format, cancelled_at)
    VALUES (m5, v_sport, DATE '2026-06-06', TIME '09:00', TIME '10:00', p1, 'competitive', 'singles', NOW());
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
    VALUES (m5, p1, 1, true, 'joined'), (m5, p2, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m5, 1, 2, 0, true, false);

  -- M6: pickleball, verified -> included only when no sport filter.
  INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by, player_expectation, format)
    VALUES (m6, v_pickle, DATE '2026-06-09', TIME '09:00', TIME '10:00', p1, 'competitive', 'singles');
  INSERT INTO match_participant (match_id, player_id, team_number, is_host, status)
    VALUES (m6, p1, 1, true, 'joined'), (m6, p2, 2, false, 'joined');
  INSERT INTO match_result (match_id, winning_team, team1_score, team2_score, is_verified, disputed)
    VALUES (m6, 1, 2, 0, true, false);

  -- A. tennis filter returns exactly the two qualifying tennis games.
  SELECT count(*) INTO v_count
    FROM get_player_match_history(p1, v_sport, 50, 0)
   WHERE match_id IN (m1, m2, m3, m4, m5, m6);
  ASSERT v_count = 2, format('tennis filter expected 2 fixture rows, got %s', v_count);

  -- B. no sport filter additionally includes the pickleball game (m6).
  SELECT count(*) INTO v_count
    FROM get_player_match_history(p1, NULL, 50, 0)
   WHERE match_id IN (m1, m2, m3, m4, m5, m6);
  ASSERT v_count = 3, format('no-filter expected 3 fixture rows, got %s', v_count);

  -- C. disputed / unverified / cancelled never appear.
  ASSERT NOT EXISTS (
    SELECT 1 FROM get_player_match_history(p1, NULL, 50, 0) WHERE match_id IN (m3, m4, m5)
  ), 'disputed/unverified/cancelled must be excluded';

  -- D. M1 singles hydration + win derivation.
  SELECT * INTO v_rec FROM get_player_match_history(p1, v_sport, 50, 0) WHERE match_id = m1;
  ASSERT v_rec.target_team_number = 1, 'M1 target_team_number';
  ASSERT v_rec.winning_team = 1, 'M1 winning_team (p1 win)';
  ASSERT jsonb_array_length(v_rec.participants) = 2, 'M1 singles -> 2 participants';
  ASSERT jsonb_array_length(v_rec.sets) = 2, 'M1 -> 2 sets';

  -- E. M2 doubles hydration: 4 participants, opponent team has 2.
  SELECT * INTO v_rec FROM get_player_match_history(p1, v_sport, 50, 0) WHERE match_id = m2;
  ASSERT v_rec.target_team_number = 1, 'M2 target_team_number';
  ASSERT v_rec.winning_team = 2, 'M2 winning_team (p1 loss)';
  ASSERT jsonb_array_length(v_rec.participants) = 4, 'M2 doubles -> 4 participants';
  ASSERT (
    SELECT count(*) FROM jsonb_array_elements(v_rec.participants) e
     WHERE (e->>'team_number')::int = 2
  ) = 2, 'M2 opponent team has 2 players';

  -- F. ordering newest-first + LIMIT/OFFSET pagination (within tennis filter).
  ASSERT (SELECT match_id FROM get_player_match_history(p1, v_sport, 1, 0)) = m1,
    'newest-first page should be M1 (2026-06-10)';
  ASSERT (SELECT match_id FROM get_player_match_history(p1, v_sport, 1, 1)) = m2,
    'offset 1 should be M2 (2026-06-05)';

  RAISE NOTICE 'PASS 1: filters, hydration, win/loss, ordering, pagination';

  -- ----------------------------------------------------------------------
  -- G. SECURITY DEFINER bypass: a non-participant authenticated viewer can
  --    read p1's PRIVATE game (m1) via the RPC, even though plain RLS hides it.
  -- ----------------------------------------------------------------------
  SET LOCAL session_replication_role = origin;  -- normal RLS semantics for this check
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid()::text)::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT (SELECT count(*) FROM match WHERE id = m1) = 0,
    'plain RLS should hide the private match from a non-participant';
  SELECT count(*) INTO v_count
    FROM get_player_match_history(p1, v_sport, 50, 0) WHERE match_id = m1;
  ASSERT v_count = 1, 'SECURITY DEFINER RPC should still return the private game';

  RESET ROLE;
  RAISE NOTICE 'PASS 2: SECURITY DEFINER returns private-match rows to non-participants';
END $$;

ROLLBACK;
