-- ============================================
-- Tournaments — min_rating HARD gate
-- ============================================
-- Covers 20260716210000: min_rating must hold for every entrant in every mode,
-- captain and partner alike, so it can be trusted as a Circuit Rallia scoring
-- input. Each block asserts one of the five paths that previously let a
-- below-floor player into the draw.
--
-- Run against a seeded local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_min_rating_gate_test.sql
--
-- One transaction, ROLLBACK at the end — safe to re-run.
-- ============================================

BEGIN;

-- Fixtures: tennis/NTRP players pinned to known ratings. Replica role bypasses
-- the active-rating validator trigger so any rating_score can stand in.
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE t_fix AS
SELECT
    (SELECT id FROM sport WHERE name = 'tennis')                          AS sport_id,
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 2.0 LIMIT 1)                  AS rs_low,   -- NTRP 2.0
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 5.0 LIMIT 1)                  AS rs_high;  -- NTRP 5.0

DO $$
DECLARE
    v_sport  uuid;
    v_low_rs uuid;
    v_hi_rs  uuid;
    v_ids    uuid[];
    v_prs    uuid;
    i        integer;
BEGIN
    SELECT sport_id, rs_low, rs_high INTO v_sport, v_low_rs, v_hi_rs FROM t_fix;
    ASSERT v_low_rs IS NOT NULL AND v_hi_rs IS NOT NULL, 'need seeded NTRP 2.0 / 5.0 rating scores';

    SELECT array_agg(player_id) INTO v_ids
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true
             ORDER BY player_id LIMIT 6) s;
    ASSERT array_length(v_ids, 1) = 6, 'need 6 tennis players';

    CREATE TEMP TABLE t_players AS SELECT unnest(v_ids) AS id, 0 AS idx;
    UPDATE t_players p SET idx = s.rn
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM t_players) s
     WHERE p.id = s.id;

    -- idx 1,2 → LOW (NTRP 2.0). idx 3,4,5,6 → HIGH (NTRP 5.0).
    FOR i IN 1..6 LOOP
        INSERT INTO player_rating_score (player_id, rating_score_id)
        VALUES ((SELECT id FROM t_players WHERE idx = i),
                CASE WHEN i <= 2 THEN v_low_rs ELSE v_hi_rs END)
        ON CONFLICT (player_id, rating_score_id) DO UPDATE SET updated_at = now()
        RETURNING id INTO v_prs;

        INSERT INTO player_sport (player_id, sport_id, active_rating_score_id)
        VALUES ((SELECT id FROM t_players WHERE idx = i), v_sport, v_prs)
        ON CONFLICT (player_id, sport_id)
        DO UPDATE SET active_rating_score_id = EXCLUDED.active_rating_score_id;
    END LOOP;

    -- The floor also accepts 180d history (20260820160000): pin the ledger
    -- too, or a fixture's seeded history can clear a floor its pinned 2.0
    -- must fail.
    DELETE FROM player_rating_history
     WHERE player_id IN (SELECT id FROM t_players) AND sport_id = v_sport;

    -- Nobody starts as an admin; block 4 promotes deliberately.
    DELETE FROM admin WHERE id IN (SELECT id FROM t_players);
END $$;


-- --------------------------------------------------------------------------
-- 1. OPEN mode — below-floor is REJECTED, not parked in 'pending'.
--    This is the soft gate's replacement: gap #4.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_hi uuid;
    v_tid uuid; v_err text; v_raised boolean := false; v_row tournament_registrations;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org FROM t_players WHERE idx = 3;   -- NTRP 5.0
    SELECT id INTO v_low FROM t_players WHERE idx = 1;   -- NTRP 2.0
    SELECT id INTO v_hi  FROM t_players WHERE idx = 4;   -- NTRP 5.0

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('MinRating Open', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0)
    RETURNING id INTO v_tid;

    -- Below the floor → hard reject.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'below-floor player was NOT rejected in open mode';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW, got ' || v_err;
    ASSERT NOT EXISTS (SELECT 1 FROM tournament_registrations
                        WHERE tournament_id = v_tid AND user_id = v_low),
        'rejected player must leave NO row (not even pending)';

    -- At/above the floor → straight to 'registered'.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    SELECT * INTO v_row FROM tournament_register(v_tid);
    ASSERT v_row.status = 'registered', 'qualifying player expected registered, got ' || v_row.status;

    RAISE NOTICE 'PASS 1: open mode — below-floor rejected (no pending row), qualifying registers';
END $$;


-- --------------------------------------------------------------------------
-- 2. APPROVAL mode — previously never consulted rating at all: gap #3.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_hi uuid;
    v_tid uuid; v_err text; v_raised boolean := false; v_row tournament_registrations;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org FROM t_players WHERE idx = 3;
    SELECT id INTO v_low FROM t_players WHERE idx = 1;
    SELECT id INTO v_hi  FROM t_players WHERE idx = 5;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('MinRating Approval', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'approval', 4.0)
    RETURNING id INTO v_tid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'approval mode must gate on rating (it did not before)';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW, got ' || v_err;

    -- Qualifying player still lands on 'pending' — approval mode is unchanged
    -- for everyone who clears the floor.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    SELECT * INTO v_row FROM tournament_register(v_tid);
    ASSERT v_row.status = 'pending', 'qualifying player in approval mode expected pending, got ' || v_row.status;

    RAISE NOTICE 'PASS 2: approval mode — below-floor rejected, qualifying still pending';
END $$;


-- --------------------------------------------------------------------------
-- 3. INVITE_ONLY — an invite used to bypass the floor entirely: gap #3.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org FROM t_players WHERE idx = 3;
    SELECT id INTO v_low FROM t_players WHERE idx = 2;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('MinRating Invite', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'invite_only', 4.0)
    RETURNING id INTO v_tid;

    -- Organizer invites the below-floor player (pending row).
    INSERT INTO tournament_registrations (tournament_id, user_id, status)
    VALUES (v_tid, v_low, 'pending');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'invite_only must gate on rating (an invite is not a waiver)';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW, got ' || v_err;
    ASSERT (SELECT status FROM tournament_registrations
             WHERE tournament_id = v_tid AND user_id = v_low) = 'pending',
        'refused invite must stay pending, not flip to registered';

    RAISE NOTICE 'PASS 3: invite_only — an invite does not waive the floor';
END $$;


-- --------------------------------------------------------------------------
-- 4. Organizer is NOT exempt; admin IS: gap #5.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org_low uuid; v_admin uuid;
    v_tid uuid; v_err text; v_raised boolean := false; v_row tournament_registrations;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org_low FROM t_players WHERE idx = 1;   -- NTRP 2.0 organizer
    SELECT id INTO v_admin   FROM t_players WHERE idx = 2;   -- NTRP 2.0, promoted below

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating)
    VALUES ('MinRating OrgFloor', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org_low, 'registration_open', 'open', 4.0)
    RETURNING id INTO v_tid;

    -- The organizer set a 4.0 floor and is 2.0 → they cannot play their own event.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org_low::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'organizer must live by the floor they set';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW for organizer, got ' || v_err;

    -- Admin keeps the support override even below the floor.
    INSERT INTO admin (id, role) VALUES (v_admin, 'super_admin') ON CONFLICT (id) DO NOTHING;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
    SELECT * INTO v_row FROM tournament_register(v_tid);
    ASSERT v_row.status = 'registered', 'admin bypass expected registered, got ' || v_row.status;

    DELETE FROM admin WHERE id = v_admin;
    RAISE NOTICE 'PASS 4: organizer bound by their own floor; admin bypass intact';
END $$;


-- --------------------------------------------------------------------------
-- 5. Doubles — the PARTNER is gated too, not just the captain: gap #2.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_capt uuid; v_low_partner uuid;
    v_tid uuid; v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org  FROM t_players WHERE idx = 3;
    SELECT id INTO v_capt FROM t_players WHERE idx = 6;   -- NTRP 5.0 captain
    SELECT id INTO v_low_partner FROM t_players WHERE idx = 1;  -- NTRP 2.0 partner

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode, min_rating, entry_format)
    VALUES ('MinRating Doubles', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'registration_open', 'open', 4.0, 'doubles')
    RETURNING id INTO v_tid;

    -- Captain clears the floor; the partner does not.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_capt::text)::text, true);
    BEGIN
        PERFORM tournament_register(v_tid, v_low_partner);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'a qualifying captain must not be able to tow a below-floor partner in';
    ASSERT v_err = 'PARTNER_RATING_TOO_LOW', 'expected PARTNER_RATING_TOO_LOW, got ' || v_err;
    ASSERT NOT EXISTS (SELECT 1 FROM tournament_registrations WHERE tournament_id = v_tid),
        'rejected doubles entry must leave no row';

    RAISE NOTICE 'PASS 5: doubles — partner is gated, not just the captain';
END $$;


-- --------------------------------------------------------------------------
-- 6. min_rating is frozen once registration opens: gap #1 (fill-then-raise).
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_tid uuid; v_ver integer;
    v_err text; v_raised boolean := false;
BEGIN
    SELECT sport_id INTO v_sport FROM t_fix;
    SELECT id INTO v_org FROM t_players WHERE idx = 3;

    INSERT INTO tournaments (name, sport_id, max_participants, start_date, end_date,
                             organizer_id, status, registration_mode)
    VALUES ('MinRating Freeze', v_sport, 8, now() + interval '7 days', now() + interval '8 days',
            v_org, 'draft', 'open')
    RETURNING id, version INTO v_tid, v_ver;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);

    -- Editable in draft.
    PERFORM tournament_update(v_tid, v_ver, '{"min_rating": 3.0}'::jsonb);
    ASSERT (SELECT min_rating FROM tournaments WHERE id = v_tid) = 3.0, 'draft edit should apply';

    -- Not editable once registration is open — the fill-then-raise exploit.
    UPDATE tournaments SET status = 'registration_open' WHERE id = v_tid;
    SELECT version INTO v_ver FROM tournaments WHERE id = v_tid;
    BEGIN
        PERFORM tournament_update(v_tid, v_ver, '{"min_rating": 5.0}'::jsonb);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'min_rating must be frozen once registration is open';
    ASSERT v_err = 'FIELD_NOT_EDITABLE:min_rating', 'expected FIELD_NOT_EDITABLE:min_rating, got ' || v_err;
    ASSERT (SELECT min_rating FROM tournaments WHERE id = v_tid) = 3.0, 'floor must be unchanged';

    RAISE NOTICE 'PASS 6: min_rating frozen at draft — fill-then-raise closed';
END $$;

ROLLBACK;
