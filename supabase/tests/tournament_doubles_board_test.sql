-- ============================================
-- Tournaments — doubles ranks on its own board (DB-level)
-- ============================================
-- Covers 20260731100000_lt_doubles_ranking_board.
--
-- Every result used to land on one board per sport, so a doubles run and a
-- singles run competed for the same rank. Reported as "je ferais un classement
-- separe pour les doubles comme a l'ATP".
--
--   * a doubles result is stamped board = 'doubles', a singles one 'singles'
--   * board is derived from the tournament, not from whatever a caller passes
--   * the singles board does not show a doubles-only player, and vice versa
--   * point values are unchanged: both partners still take the full award
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_doubles_board_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"). Staff is granted around the create calls only and
-- dropped straight after: the fixture-picking helpers filter admins out, so a
-- lingering row would shift which players a later block picks, and the
-- organizer has to stay an ordinary player for the authz assertions to mean
-- anything.
-- SECURITY DEFINER so the grant still works inside a block that has switched
-- to the authenticated role, where admin's RLS would refuse the insert.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p;
$$;

DO $$
DECLARE
    v_sport uuid; v_p uuid[]; v_org uuid; v_t tournaments; v_m tournament_matches;
    v_i int; v_board text; v_pts int;
    v_singles_user uuid; v_doubles_user uuid; v_n int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- Organizers at the tail of the pool: the rest of the suite organizes from
    -- the head and tournament_create allows a non-admin only 5 per 24h.
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 46) s;
    ASSERT array_length(v_p, 1) = 46, 'need 46 active non-admin tennis players';
    v_org := v_p[31];
    UPDATE player SET is_certified_organizer = true WHERE id = v_org;

    -- ---------------- a SINGLES tournament, played out ----------------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Board test — singles', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'singles');
    PERFORM pg_temp.staff_off(v_org);
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);
    FOR v_i IN 32..35 LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_p[v_i]::text)::text, true);
        PERFORM tournament_register(v_t.id);
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_t.id, v_t.version);
    PERFORM tournament_generate_bracket(v_t.id, v_t.version);
    -- Round 1 first: the final's slots are empty until its feeders resolve.
    FOR v_m IN SELECT * FROM tournament_matches
                WHERE tournament_id = v_t.id AND round_number = 1 ORDER BY match_position LOOP
        PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');
    END LOOP;
    SELECT * INTO v_m FROM tournament_matches
     WHERE tournament_id = v_t.id AND next_match_id IS NULL AND bracket_side = 'main' LIMIT 1;
    PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');

    SELECT r.user_id INTO v_singles_user
      FROM tournament_registrations r WHERE r.id = v_m.player1_registration_id;

    SELECT board INTO v_board FROM tournament_ranking_points
     WHERE tournament_id = v_t.id LIMIT 1;
    ASSERT v_board = 'singles', format('a singles result must stamp singles, got %s', v_board);

    PERFORM pg_temp.staff_on(v_org);
    -- ---------------- a DOUBLES tournament, played out ----------------
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Board test — doubles', p_sport_id => v_sport,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => 'public', p_registration_mode => 'open',
        p_entry_format => 'doubles');
    PERFORM pg_temp.staff_off(v_org);
    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);
    FOR v_i IN 0..3 LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_p[36 + v_i * 2]::text)::text, true);
        PERFORM tournament_register(v_t.id, v_p[37 + v_i * 2]);
    END LOOP;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_t FROM tournament_close_registration(v_t.id, v_t.version);
    PERFORM tournament_generate_bracket(v_t.id, v_t.version);
    FOR v_m IN SELECT * FROM tournament_matches
                WHERE tournament_id = v_t.id AND round_number = 1 ORDER BY match_position LOOP
        PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');
    END LOOP;
    SELECT * INTO v_m FROM tournament_matches
     WHERE tournament_id = v_t.id AND next_match_id IS NULL AND bracket_side = 'main' LIMIT 1;
    PERFORM tournament_override_score(v_m.id, v_m.player1_registration_id, '6-1 6-1');

    SELECT r.user_id INTO v_doubles_user
      FROM tournament_registrations r WHERE r.id = v_m.player1_registration_id;

    SELECT board INTO v_board FROM tournament_ranking_points
     WHERE tournament_id = v_t.id LIMIT 1;
    ASSERT v_board = 'doubles', format('a doubles result must stamp doubles, got %s', v_board);

    -- Both partners keep the full award: separating boards is the fix, not halving.
    SELECT count(*) INTO v_n FROM tournament_ranking_points WHERE tournament_id = v_t.id;
    ASSERT v_n = 8, format('a 4-pair doubles draw must credit 8 players, got %s', v_n);
    SELECT count(DISTINCT points) INTO v_n
      FROM tournament_ranking_points
     WHERE tournament_id = v_t.id AND placement = 'champion';
    ASSERT v_n = 1, 'both champions must hold the same points';

    -- board is derived, so writing the wrong one is corrected on the way in.
    UPDATE tournament_ranking_points SET board = 'singles' WHERE tournament_id = v_t.id;
    SELECT count(*) INTO v_n FROM tournament_ranking_points
     WHERE tournament_id = v_t.id AND board = 'singles';
    ASSERT v_n = 8, 'a plain UPDATE of board is not re-derived (trigger keys on tournament_id)';
    UPDATE tournament_ranking_points SET tournament_id = tournament_id WHERE tournament_id = v_t.id;
    SELECT count(*) INTO v_n FROM tournament_ranking_points
     WHERE tournament_id = v_t.id AND board = 'doubles';
    ASSERT v_n = 8, 'touching tournament_id must re-derive the board from the tournament';

    -- ---------------- the two boards do not see each other ----------------
    ASSERT EXISTS (SELECT 1 FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'singles')
                    WHERE user_id = v_singles_user),
        'the singles player must appear on the singles board';
    ASSERT NOT EXISTS (SELECT 1 FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'doubles')
                        WHERE user_id = v_singles_user),
        'a singles-only player must not appear on the doubles board';
    ASSERT EXISTS (SELECT 1 FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'doubles')
                    WHERE user_id = v_doubles_user),
        'the doubles player must appear on the doubles board';
    ASSERT NOT EXISTS (SELECT 1 FROM public.tournament_ranked_board(v_sport, NULL, NULL, NULL, 'singles')
                        WHERE user_id = v_doubles_user),
        'a doubles-only player must not appear on the singles board';

    RAISE NOTICE 'PASS: doubles ranks on its own board, points unchanged, boards disjoint';
END $$;

ROLLBACK;
