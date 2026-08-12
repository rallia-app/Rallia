-- ============================================
-- Tournaments — pool_knockout notifications (spec §12)
-- ============================================
-- A 14-player pool_knockout tournament, so the field splits [4,4,3,3] and two
-- pools hold three players. That shape is the point: a 3-player pool pads to 4
-- with a phantom, so one member of each has NO round-1 game, and the
-- single-elimination branch of notify_tournament_lifecycle keyed on exactly
-- that row and dropped them without a trace.
--
-- Asserts:
--   * pools published  → all 14 entrants notified, with their pool, and NOT
--     with the knockout's "round 1 vs X" copy;
--   * knockout published → the 8 qualifiers hear that the tree is live (the
--     cut-over changes no status, so no trigger fires: the RPC must announce
--     itself), and the 6 who went out hear their pool placing.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_notifications_test.sql
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

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"), so the create RPC now refuses a plain player. These
-- tests still drive everything AFTER creation as an ordinary organizer, so
-- staff is granted around the create calls and dropped again before the block
-- ends. It has to be dropped: pg_temp.tennis_players() filters admins out, so
-- a lingering row would shift every fixture picked by a later block.
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM admin WHERE id = p;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_ver     integer;
    v_order   uuid[];
    v_tm      tournament_matches;
    v_seeds   uuid[];
    v_win     uuid;
    v_cnt     integer;
    v_bad     integer;
BEGIN
    v_players := pg_temp.tennis_players(15);
    v_org     := v_players[15];

    PERFORM pg_temp.staff_on(v_org);
    PERFORM pg_temp.as_user(v_org);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Notifications', (SELECT id FROM sport WHERE name = 'tennis'),
        16::smallint, now() + interval '7 days', now() + interval '28 days',
        p_bracket_type => 'pool_knockout');

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..14 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);

    -- Seed explicitly: one transaction freezes now(), so registered_at ties and
    -- the order would otherwise fall through to the registration uuid.
    SELECT array_agg(tr.id ORDER BY array_position(v_players[1:14], tr.user_id))
      INTO v_order FROM tournament_registrations tr
     WHERE tr.tournament_id = v_t.id AND tr.status = 'registered';
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_set_seeds(v_t.id, v_order, v_ver);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- The shape this test exists for.
    SELECT count(*) INTO v_cnt FROM (
        SELECT tm.pool_number FROM tournament_matches tm
         WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'pool'
         GROUP BY tm.pool_number HAVING count(*) = 3) z;
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'expected two 3-player pools (3 games each), got %', v_cnt;
    END IF;

    -- 1) Every entrant hears about their pool.
    SELECT count(DISTINCT n.user_id) INTO v_cnt
      FROM notification n
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_bracket_published';
    IF v_cnt <> 14 THEN
        RAISE EXCEPTION 'pools published reached % of 14 entrants', v_cnt;
    END IF;

    SELECT count(*) INTO v_bad
      FROM notification n
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_bracket_published'
       AND (n.title NOT IN ('Poules dévoilées', 'Pools published')
            OR n.payload->>'poolLetter' IS NULL
            OR n.body ILIKE '%tour 1%' OR n.body ILIKE '%round 1%');
    IF v_bad <> 0 THEN
        RAISE EXCEPTION '% pools notice(s) carried knockout copy or no pool', v_bad;
    END IF;

    -- Settle every pool game in seed order so the ranks are deterministic.
    v_seeds := ARRAY(
        SELECT tr.id FROM tournament_registrations tr
         WHERE tr.tournament_id = v_t.id
         ORDER BY tr.seed_rank ASC NULLS LAST, tr.registered_at ASC, tr.id ASC);
    PERFORM pg_temp.as_user(v_org);
    FOR v_tm IN
        SELECT * FROM tournament_matches
         WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND status = 'pending'
         ORDER BY round_number, match_position
    LOOP
        IF array_position(v_seeds, v_tm.player1_registration_id)
           <= array_position(v_seeds, v_tm.player2_registration_id) THEN
            v_win := v_tm.player1_registration_id;
        ELSE
            v_win := v_tm.player2_registration_id;
        END IF;
        -- Player1-first score text (20260812210000).
        PERFORM public.tournament_override_score(
            v_tm.id, v_win,
            CASE WHEN v_win = v_tm.player1_registration_id THEN '6-2 6-3' ELSE '2-6 3-6' END);
    END LOOP;

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_knockout(v_t.id, v_ver);

    -- 4 pools x 2 qualifiers = 8 → exact 8-draw, no byes.
    SELECT count(*) INTO v_cnt FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'main';
    IF v_cnt <> 7 THEN
        RAISE EXCEPTION 'expected 7 knockout rows, got %', v_cnt;
    END IF;

    -- 2) The 8 qualifiers hear the tree is live.
    SELECT count(DISTINCT n.user_id) INTO v_cnt
      FROM notification n
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_bracket_published'
       AND n.title IN ('Tableau dévoilé', 'Bracket published');
    IF v_cnt <> 8 THEN
        RAISE EXCEPTION 'knockout published reached % of 8 qualifiers', v_cnt;
    END IF;

    -- 3) The 6 who went out hear their placing, and only them.
    SELECT count(DISTINCT n.user_id) INTO v_cnt
      FROM notification n
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_pool_eliminated';
    IF v_cnt <> 6 THEN
        RAISE EXCEPTION 'pool elimination reached % of 6, expected 6', v_cnt;
    END IF;

    SELECT count(*) INTO v_bad
      FROM notification n
      JOIN tournament_registrations r ON r.user_id = n.user_id
                                     AND r.tournament_id = v_t.id
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_pool_eliminated'
       AND EXISTS (
         SELECT 1 FROM tournament_matches tm
          WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'main'
            AND r.id IN (tm.player1_registration_id, tm.player2_registration_id));
    IF v_bad <> 0 THEN
        RAISE EXCEPTION '% qualifier(s) were told they had been eliminated', v_bad;
    END IF;

    -- The placing has to actually be in the copy.
    SELECT count(*) INTO v_bad
      FROM notification n
     WHERE n.payload->>'tournamentId' = v_t.id::text
       AND n.type = 'tournament_pool_eliminated'
       AND (n.payload->>'poolRank' IS NULL OR (n.payload->>'poolRank')::int < 2);
    IF v_bad <> 0 THEN
        RAISE EXCEPTION '% elimination notice(s) missing a sane pool rank', v_bad;
    END IF;

    PERFORM pg_temp.staff_off(v_org);
    RAISE NOTICE 'tournament_pool_notifications_test: ALL PASS';
END;
$$;

ROLLBACK;
