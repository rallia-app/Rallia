-- ============================================
-- Rating band — 180d history qualifies UPWARD
-- ============================================
-- Covers 20260820160000: a player whose rating dropped across a band boundary
-- must still have an eligible draw. The floor passes on current rating OR the
-- 180-day history max; the prize ceiling on the cap side is unchanged.
--
-- Run against a seeded local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_rating_ceiling_upward_test.sql
--
-- One transaction, ROLLBACK at the end — safe to re-run.
-- ============================================

BEGIN;

-- Fixtures under replica role: bypasses the active-rating validator AND the
-- history-logging triggers, so the ledger below holds exactly the rows this
-- test inserts. Flipped back to 'origin' before the blocks — the prize
-- ceiling is a trigger and must actually fire.
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE t_fix AS
SELECT
    (SELECT id FROM sport WHERE name = 'tennis')                          AS sport_id,
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 3.5 LIMIT 1)                  AS rs_35,
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 5.0 LIMIT 1)                  AS rs_50;

DO $$
DECLARE
    v_sport uuid;
    v_rs35  uuid;
    v_rs50  uuid;
    v_ids   uuid[];
    v_prs   uuid;
    v_rs    uuid;
    i       integer;
BEGIN
    SELECT sport_id, rs_35, rs_50 INTO v_sport, v_rs35, v_rs50 FROM t_fix;
    ASSERT v_rs35 IS NOT NULL AND v_rs50 IS NOT NULL, 'need seeded NTRP 3.5 / 5.0 rating scores';

    SELECT array_agg(player_id) INTO v_ids
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 7) s;
    ASSERT array_length(v_ids, 1) = 7, 'need 7 tennis players';

    CREATE TEMP TABLE t_players AS SELECT unnest(v_ids) AS id, 0 AS idx;
    UPDATE t_players p SET idx = s.rn
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM t_players) s
     WHERE p.id = s.id;

    -- idx 1 dropper   → 3.5 now, 4.0 in the window
    -- idx 2 stable    → 3.5 now, no history
    -- idx 3 organizer → 5.0
    -- idx 4 captain   → 5.0
    -- idx 5 unrated   → NO active rating, 4.0 in the window
    -- idx 6 aged      → 3.5 now, 4.0 but 200 days old
    -- idx 7 cleared   → 3.5 now, 4.0 in the window but admin-cleared
    FOR i IN 1..7 LOOP
        v_rs := CASE WHEN i IN (3, 4) THEN v_rs50 ELSE v_rs35 END;

        IF i = 5 THEN
            INSERT INTO player_sport (player_id, sport_id, active_rating_score_id)
            VALUES ((SELECT id FROM t_players WHERE idx = i), v_sport, NULL)
            ON CONFLICT (player_id, sport_id)
            DO UPDATE SET active_rating_score_id = NULL;
        ELSE
            INSERT INTO player_rating_score (player_id, rating_score_id)
            VALUES ((SELECT id FROM t_players WHERE idx = i), v_rs)
            ON CONFLICT (player_id, rating_score_id) DO UPDATE SET updated_at = now()
            RETURNING id INTO v_prs;

            INSERT INTO player_sport (player_id, sport_id, active_rating_score_id)
            VALUES ((SELECT id FROM t_players WHERE idx = i), v_sport, v_prs)
            ON CONFLICT (player_id, sport_id)
            DO UPDATE SET active_rating_score_id = EXCLUDED.active_rating_score_id;
        END IF;
    END LOOP;

    -- The ledger holds exactly what this test says it holds.
    DELETE FROM player_rating_history
     WHERE player_id IN (SELECT id FROM t_players) AND sport_id = v_sport;

    INSERT INTO player_rating_history (player_id, sport_id, rating_value, recorded_at)
    VALUES
        ((SELECT id FROM t_players WHERE idx = 1), v_sport, 4.0, now() - interval '30 days'),
        ((SELECT id FROM t_players WHERE idx = 5), v_sport, 4.0, now() - interval '30 days'),
        ((SELECT id FROM t_players WHERE idx = 6), v_sport, 4.0, now() - interval '200 days');

    INSERT INTO player_rating_history (player_id, sport_id, rating_value, recorded_at, admin_cleared_at)
    VALUES ((SELECT id FROM t_players WHERE idx = 7), v_sport, 4.0, now() - interval '30 days', now());

    DELETE FROM admin WHERE id IN (SELECT id FROM t_players);
END $$;

SET LOCAL session_replication_role = 'origin';


-- --------------------------------------------------------------------------
-- 1. THE FIX — the dead zone is gone: current 3.5 with a 4.0 window max
--    enters the 4.0+ draw. Before 20260820160000 this raised RATING_TOO_LOW,
--    and block 2 shows the 3.0–3.5 prize draw still refuses, i.e. this draw
--    was the player's ONLY way in.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_dropper uuid;
    v_tid uuid; v_row tournament_registrations;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org     FROM t_players WHERE idx = 3;
    SELECT id INTO v_dropper FROM t_players WHERE idx = 1;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating, prize_money_cents)
    VALUES ('Ceiling Upward Avancé', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0, 100000)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dropper::text)::text, true);
    SELECT * INTO v_row FROM tournament_register(v_tid);
    ASSERT v_row.status = 'registered', 'window-max 4.0 must clear the 4.0 floor, got ' || v_row.status;

    RAISE NOTICE 'PASS 1: 180d history max clears the floor of the higher draw';
END $$;


-- --------------------------------------------------------------------------
-- 2. Sandbagging protection intact — the same player is still refused from
--    the 3.0–3.5 prize draw by the ceiling trigger.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_dropper uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org     FROM t_players WHERE idx = 3;
    SELECT id INTO v_dropper FROM t_players WHERE idx = 1;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating, max_rating, prize_money_cents)
    VALUES ('Ceiling Upward Inter', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 3.0, 3.5, 100000)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dropper::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'the prize ceiling must still refuse the lower draw';
    ASSERT v_err = 'RATING_RECENTLY_HIGHER', 'expected RATING_RECENTLY_HIGHER, got ' || v_err;

    RAISE NOTICE 'PASS 2: prize ceiling on the lower draw unchanged';
END $$;


-- --------------------------------------------------------------------------
-- 3. The floor is relaxed, not removed — 3.5 with no qualifying history is
--    still refused from 4.0+, and a 4.0 outside the 180-day window is too.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_stable uuid; v_aged uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org    FROM t_players WHERE idx = 3;
    SELECT id INTO v_stable FROM t_players WHERE idx = 2;
    SELECT id INTO v_aged   FROM t_players WHERE idx = 6;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('Ceiling Upward Floor', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stable::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'no history: the floor must still hold';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW, got ' || v_err;

    v_raised := false;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_aged::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'a 200-day-old 4.0 must not clear the floor';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW for aged history, got ' || v_err;

    RAISE NOTICE 'PASS 3: floor holds without in-window history';
END $$;


-- --------------------------------------------------------------------------
-- 4. An admin-accepted drop removes the upward qualification along with the
--    ceiling: cleared rows count for neither side.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_cleared uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org     FROM t_players WHERE idx = 3;
    SELECT id INTO v_cleared FROM t_players WHERE idx = 7;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('Ceiling Upward Cleared', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cleared::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'admin-cleared history must not clear the floor';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW for cleared history, got ' || v_err;

    RAISE NOTICE 'PASS 4: admin-cleared rows qualify nothing';
END $$;


-- --------------------------------------------------------------------------
-- 5. Doubles — the partner gets the same upward qualification, and a partner
--    without it is still refused.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_capt uuid; v_dropper uuid; v_stable uuid;
    v_tid uuid; v_err text; v_raised boolean := false; v_row tournament_registrations;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org     FROM t_players WHERE idx = 3;
    SELECT id INTO v_capt    FROM t_players WHERE idx = 4;
    SELECT id INTO v_dropper FROM t_players WHERE idx = 1;
    SELECT id INTO v_stable  FROM t_players WHERE idx = 2;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating, entry_format)
    VALUES ('Ceiling Upward Doubles', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0, 'doubles')
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_capt::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid, v_stable);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'partner without qualifying history must still be refused';
    ASSERT v_err = 'PARTNER_RATING_TOO_LOW', 'expected PARTNER_RATING_TOO_LOW, got ' || v_err;

    SELECT * INTO v_row FROM tournament_register(v_tid, v_dropper);
    ASSERT v_row.status = 'registered', 'partner with window-max 4.0 must be admitted, got ' || v_row.status;
    ASSERT v_row.partner_user_id = v_dropper, 'partner must be recorded on the entry';

    RAISE NOTICE 'PASS 5: partner qualifies upward on the same rule';
END $$;


-- --------------------------------------------------------------------------
-- 6. Unrated stays unrated — history must not rescue a player with no active
--    rating: an unverifiable entrant breaks the band either way.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_unrated uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org     FROM t_players WHERE idx = 3;
    SELECT id INTO v_unrated FROM t_players WHERE idx = 5;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('Ceiling Upward Unrated', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrated::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'no active rating must still be refused';
    ASSERT v_err = 'RATING_REQUIRED', 'expected RATING_REQUIRED, got ' || v_err;

    RAISE NOTICE 'PASS 6: history does not rescue an unrated player';
END $$;

ROLLBACK;
