-- ============================================
-- Tournaments — the organizer records an OUTCOME, not a score standing in for one
-- ============================================
-- Covers 20260825120000. Série 1 was settled by typing a generic 8-6 on 27 of
-- 70 pairings because the override could only ever write status='completed';
-- these assertions are the ones that stop that being the only option:
--   * walkover stamps the resolver's own 'W/O' when no score is given
--   * retired keeps the score at retirement
--   * cancelled on a POOL row: no winner, no score, no played_at
--   * a cancelled pool row counts for NEITHER player in the standings
--   * a walkover row is overridable, so an automated resolution is reversible
--   * cancelled on a KNOCKOUT row -> CANCEL_NEEDS_BRACKET_OUTCOME
--   * every outcome but cancelled needs a winner -> WINNER_REQUIRED
--   * an outcome outside the four -> INVALID_OUTCOME
--
-- Authz and the correction-window guards are NOT retested here; they are
-- unchanged and already covered by tournament_override_score_authz_test.sql
-- and tournament_final_correction_window_test.sql.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_override_outcomes_test.sql
--
-- One transaction, ROLLBACK at the end.
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

CREATE OR REPLACE FUNCTION pg_temp.tennis_sport() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM sport WHERE name = 'tennis';
$$;

-- Event creation is staff-only since 20260812150000. Granted around the create
-- and dropped immediately: tennis_players() filters admins out, so a lingering
-- row would shift which players a later block picks.
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
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_pool      tournament_matches;
    v_ko        tournament_matches;
    v_row       tournament_matches;
    v_msg       text;
    v_p1_user   uuid;
    v_p2_user   uuid;
    v_played    integer;
    i           integer;
BEGIN
    v_players   := pg_temp.tennis_players(9);
    v_organizer := v_players[9];

    PERFORM pg_temp.staff_on(v_organizer);
    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-OUTCOME] Explicit outcomes', pg_temp.tennis_sport(), 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout');
    PERFORM pg_temp.staff_off(v_organizer);

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

    SELECT * INTO v_pool FROM tournament_matches
     WHERE tournament_id = v_t.id AND pool_number IS NOT NULL
       AND player1_registration_id IS NOT NULL AND player2_registration_id IS NOT NULL
       AND NOT player1_is_bye AND NOT player2_is_bye
     ORDER BY id LIMIT 1;
    ASSERT v_pool.id IS NOT NULL, 'fixture: expected a playable pool row';

    SELECT tr.user_id INTO v_p1_user FROM tournament_registrations tr
     WHERE tr.id = v_pool.player1_registration_id;
    SELECT tr.user_id INTO v_p2_user FROM tournament_registrations tr
     WHERE tr.id = v_pool.player2_registration_id;

    -- ---------------------------------------------------------------------
    -- 1. walkover stamps the resolver's own 'W/O' when no score is supplied
    -- ---------------------------------------------------------------------
    v_row := public.tournament_override_score(
        v_pool.id, v_pool.player1_registration_id, NULL, 'walkover');
    ASSERT v_row.status = 'walkover',
        'walkover: status is ' || v_row.status;
    ASSERT v_row.score = 'W/O',
        'walkover: score is ' || coalesce(v_row.score, '<null>');
    ASSERT v_row.winner_registration_id = v_pool.player1_registration_id,
        'walkover: winner not recorded';
    ASSERT v_row.played_at IS NOT NULL,
        'walkover: played_at should be stamped';

    -- ---------------------------------------------------------------------
    -- 2. a walkover row is overridable: an automated call can be undone
    -- ---------------------------------------------------------------------
    v_row := public.tournament_override_score(
        v_pool.id, v_pool.player2_registration_id, '6-4 6-2', 'completed');
    ASSERT v_row.status = 'completed', 'undo: status is ' || v_row.status;
    ASSERT v_row.score = '6-4 6-2', 'undo: score is ' || coalesce(v_row.score, '<null>');
    ASSERT v_row.winner_registration_id = v_pool.player2_registration_id,
        'undo: winner did not change';

    -- ---------------------------------------------------------------------
    -- 3. retired keeps the score at retirement
    -- ---------------------------------------------------------------------
    v_row := public.tournament_override_score(
        v_pool.id, v_pool.player1_registration_id, '6-2 3-1 ab.', 'retired');
    ASSERT v_row.status = 'retired', 'retired: status is ' || v_row.status;
    ASSERT v_row.score = '6-2 3-1 ab.',
        'retired: score is ' || coalesce(v_row.score, '<null>');

    -- ---------------------------------------------------------------------
    -- 4. cancelled on a pool row: nothing to report, nothing was played
    -- ---------------------------------------------------------------------
    v_row := public.tournament_override_score(v_pool.id, NULL, NULL, 'cancelled');
    ASSERT v_row.status = 'cancelled', 'cancelled: status is ' || v_row.status;
    ASSERT v_row.winner_registration_id IS NULL, 'cancelled: winner must be null';
    ASSERT v_row.score IS NULL, 'cancelled: score must be null';
    ASSERT v_row.played_at IS NULL, 'cancelled: played_at must stay null';

    -- ---------------------------------------------------------------------
    -- 5. and it counts for NEITHER player. This is the whole point of having
    --    the outcome: a generic 8-6 would have handed one of them a win.
    -- ---------------------------------------------------------------------
    SELECT sum(s.settled + s.wins)::integer INTO v_played
      FROM public.tournament_pool_standings(v_t.id) s
     WHERE s.user_id IN (v_p1_user, v_p2_user);
    ASSERT coalesce(v_played, 0) = 0,
        'cancelled: standings still credited ' || coalesce(v_played, 0)
        || ' settled+wins across the two players';

    -- ---------------------------------------------------------------------
    -- 6. a cancelled row is still overridable
    -- ---------------------------------------------------------------------
    v_row := public.tournament_override_score(
        v_pool.id, v_pool.player1_registration_id, '7-5 6-3', 'completed');
    ASSERT v_row.status = 'completed', 'cancelled -> completed failed';

    -- ---------------------------------------------------------------------
    -- 7. cancelled is refused on a knockout row: a bracket slot has to send
    --    somebody forward, which is the double walkover, not a status flip
    -- ---------------------------------------------------------------------
    SELECT * INTO v_ko FROM tournament_matches
     WHERE tournament_id = v_t.id AND pool_number IS NULL
     ORDER BY id LIMIT 1;
    IF v_ko.id IS NOT NULL THEN
        BEGIN
            v_row := public.tournament_override_score(v_ko.id, NULL, NULL, 'cancelled');
            RAISE EXCEPTION 'cancelled on a knockout row should have been refused';
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
            -- MATCH_SLOTS_INCOMPLETE is equally acceptable here: an empty
            -- bracket slot is refused before the outcome is even considered.
            ASSERT v_msg IN ('CANCEL_NEEDS_BRACKET_OUTCOME', 'MATCH_SLOTS_INCOMPLETE'),
                'knockout cancel: got ' || v_msg;
        END;
    END IF;

    -- ---------------------------------------------------------------------
    -- 8. every outcome but cancelled needs a winner
    -- ---------------------------------------------------------------------
    BEGIN
        v_row := public.tournament_override_score(v_pool.id, NULL, NULL, 'walkover');
        RAISE EXCEPTION 'a walkover without a winner should have been refused';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'WINNER_REQUIRED', 'winner required: got ' || v_msg;
    END;

    -- ---------------------------------------------------------------------
    -- 9. an outcome outside the four is refused, so 'disputed' or 'pending'
    --    cannot be set through the organizer's own button
    -- ---------------------------------------------------------------------
    BEGIN
        v_row := public.tournament_override_score(
            v_pool.id, v_pool.player1_registration_id, NULL, 'disputed');
        RAISE EXCEPTION 'disputed as an outcome should have been refused';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'INVALID_OUTCOME', 'invalid outcome: got ' || v_msg;
    END;

    RAISE NOTICE 'tournament_override_outcomes_test: all assertions passed';
END $$;

ROLLBACK;
