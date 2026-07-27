-- ============================================
-- Tournaments — next-match-ready notification test
-- ============================================
-- Asserts lt_advance_tournament_winner sends 'tournament_match_ready' to both
-- players of a next-round match exactly when it becomes playable (both feeder
-- matches resolved), and not before.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_match_ready_notify_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_sport uuid;
    v_players uuid[];
    v_org uuid;
    v_t tournaments;
    v_tid uuid;
    v_ver int;
    v_r1m1 tournament_matches;
    v_r1m2 tournament_matches;
    v_r2m1 tournament_matches;
    v_n int;
    i int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_players
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
             ORDER BY player_id LIMIT 9) s;
    ASSERT array_length(v_players, 1) = 9, 'need 9 active tennis players';
    v_org := v_players[1];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Notify Cup', p_sport_id => v_sport, p_max_participants => 8::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open');
    v_tid := v_t.id; v_ver := v_t.version;
    SELECT * INTO v_t FROM tournament_open_registration(v_tid, v_ver); v_ver := v_t.version;

    -- 8 players register → full bracket, no byes
    FOR i IN 2..9 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[i]::text)::text, true);
        PERFORM tournament_register(v_tid);
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_tid, v_ver); v_ver := v_t.version;
    PERFORM tournament_generate_bracket(v_tid, v_ver);

    SELECT * INTO v_r1m1 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_r1m2 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 1 AND match_position = 2;

    -- Advance only the first feeder → next match still has an empty slot → silent.
    PERFORM lt_advance_tournament_winner(v_r1m1.id, v_r1m1.player1_registration_id);
    SELECT count(*) INTO v_n FROM notification
      WHERE type = 'tournament_match_ready' AND target_id = v_tid;
    ASSERT v_n = 0, 'no match-ready notification until both feeders resolved, got ' || v_n;

    -- Advance the second feeder → next match playable → both players notified.
    PERFORM lt_advance_tournament_winner(v_r1m2.id, v_r1m2.player1_registration_id);
    SELECT count(*) INTO v_n FROM notification
      WHERE type = 'tournament_match_ready' AND target_id = v_tid;
    ASSERT v_n = 2, 'expected 2 match-ready notifications, got ' || v_n;

    SELECT * INTO v_r2m1 FROM tournament_matches
      WHERE tournament_id = v_tid AND round_number = 2 AND match_position = 1;
    ASSERT EXISTS (
        SELECT 1 FROM notification n
        JOIN tournament_registrations r ON r.id = v_r2m1.player1_registration_id
        WHERE n.type = 'tournament_match_ready'
          AND n.target_id = v_tid AND n.user_id = r.user_id
    ), 'R2M1 player1 should be notified';
    ASSERT EXISTS (
        SELECT 1 FROM notification n
        JOIN tournament_registrations r ON r.id = v_r2m1.player2_registration_id
        WHERE n.type = 'tournament_match_ready'
          AND n.target_id = v_tid AND n.user_id = r.user_id
    ), 'R2M1 player2 should be notified';

    RAISE NOTICE 'PASS: next-match-ready notifies both players exactly when the match becomes playable';
END $$;

ROLLBACK;
