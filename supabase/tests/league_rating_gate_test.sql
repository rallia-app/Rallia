-- ============================================
-- Leagues — league_join's rating gate
-- ============================================
-- Covers 20260725130000. The gate shipped in 20260615120000 joined
-- player_sport.active_rating_score_id to rating_score.id, but that column holds
-- a player_rating_score.id — so v_rating was always NULL and the gate inverted:
-- a floor rejected everybody, a ceiling alone rejected nobody. Blocks 2 and 3
-- below are exactly those two regressions.
--
-- Run against a seeded local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_rating_gate_test.sql
--
-- One transaction, ROLLBACK at the end — safe to re-run.
-- ============================================

BEGIN;

-- Fixtures: tennis players pinned to known NTRP ratings. Replica role bypasses
-- the active-rating validator trigger so any rating_score can stand in.
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE l_fix AS
SELECT
    (SELECT id FROM sport WHERE name = 'tennis')                          AS sport_id,
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 2.0 LIMIT 1)                  AS rs_low,   -- NTRP 2.0
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 4.0 LIMIT 1)                  AS rs_mid,   -- NTRP 4.0
    (SELECT rs.id FROM rating_score rs
       JOIN rating_system sy ON sy.id = rs.rating_system_id
      WHERE sy.name = 'NTRP' AND rs.value = 5.0 LIMIT 1)                  AS rs_high;  -- NTRP 5.0

DO $$
DECLARE
    v_sport uuid; v_low_rs uuid; v_mid_rs uuid; v_hi_rs uuid;
    v_ids   uuid[];
    v_prs   uuid;
    i       integer;
BEGIN
    SELECT sport_id, rs_low, rs_mid, rs_high
      INTO v_sport, v_low_rs, v_mid_rs, v_hi_rs FROM l_fix;
    ASSERT v_low_rs IS NOT NULL AND v_mid_rs IS NOT NULL AND v_hi_rs IS NOT NULL,
        'need seeded NTRP 2.0 / 4.0 / 5.0 rating scores';

    SELECT array_agg(player_id) INTO v_ids
      FROM (SELECT player_id FROM player_sport
             WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
             ORDER BY player_id LIMIT 5) s;
    ASSERT array_length(v_ids, 1) = 5, 'need 5 tennis players';

    CREATE TEMP TABLE l_players AS SELECT unnest(v_ids) AS id, 0 AS idx;
    UPDATE l_players p SET idx = s.rn
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM l_players) s
     WHERE p.id = s.id;

    -- idx 1 → NTRP 2.0, idx 2 → 4.0, idx 3 → 5.0, idx 5 (organizer) → 4.0.
    -- idx 4 is left UNRATED on purpose.
    FOR i IN 1..5 LOOP
        IF i = 4 THEN
            UPDATE player_sport SET active_rating_score_id = NULL, is_active = true
             WHERE player_id = (SELECT id FROM l_players WHERE idx = i)
               AND sport_id = v_sport;
            CONTINUE;
        END IF;

        INSERT INTO player_rating_score (player_id, rating_score_id)
        VALUES ((SELECT id FROM l_players WHERE idx = i),
                CASE i WHEN 1 THEN v_low_rs WHEN 3 THEN v_hi_rs ELSE v_mid_rs END)
        ON CONFLICT (player_id, rating_score_id) DO UPDATE SET updated_at = now()
        RETURNING id INTO v_prs;

        INSERT INTO player_sport (player_id, sport_id, active_rating_score_id)
        VALUES ((SELECT id FROM l_players WHERE idx = i), v_sport, v_prs)
        ON CONFLICT (player_id, sport_id)
        DO UPDATE SET active_rating_score_id = EXCLUDED.active_rating_score_id,
                      is_active = true;
    END LOOP;

    -- The floor also accepts 180d history (20260820160000): pin the ledger
    -- too, or a fixture's seeded history can clear a floor its pinned rating
    -- must fail.
    DELETE FROM player_rating_history
     WHERE player_id IN (SELECT id FROM l_players) AND sport_id = v_sport;
END $$;


-- --------------------------------------------------------------------------
-- 1. Full band 3.5–4.5 — in-band joins, each way out of the band is named.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_mid uuid; v_hi uuid; v_unrated uuid;
    v_lid uuid; v_err text; v_raised boolean; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_low     FROM l_players WHERE idx = 1;
    SELECT id INTO v_mid     FROM l_players WHERE idx = 2;
    SELECT id INTO v_hi      FROM l_players WHERE idx = 3;
    SELECT id INTO v_unrated FROM l_players WHERE idx = 4;
    SELECT id INTO v_org     FROM l_players WHERE idx = 5;

    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, min_rating, max_rating)
    VALUES ('Band 3.5-4.5', v_sport, v_org, 'open', 'active', 3.5, 4.5)
    RETURNING id INTO v_lid;

    -- In band → active member.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mid::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'in-band player expected active, got ' || v_row.status;

    -- Below the floor.
    v_raised := false;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'below-floor player was NOT rejected';
    ASSERT v_err = 'RATING_TOO_LOW', 'expected RATING_TOO_LOW, got ' || v_err;
    ASSERT NOT EXISTS (SELECT 1 FROM league_members
                        WHERE league_id = v_lid AND user_id = v_low),
        'rejected player must leave NO membership row';

    -- Above the ceiling.
    v_raised := false;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'above-ceiling player was NOT rejected';
    ASSERT v_err = 'RATING_TOO_HIGH', 'expected RATING_TOO_HIGH, got ' || v_err;

    -- Unrated: either bound present → rejected, same as tournaments.
    v_raised := false;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrated::text)::text, true);
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'unrated player was NOT rejected';
    ASSERT v_err = 'RATING_REQUIRED', 'expected RATING_REQUIRED, got ' || v_err;

    RAISE NOTICE 'PASS 1: band 3.5-4.5 — in-band joins; low/high/unrated each rejected by name';
END $$;


-- --------------------------------------------------------------------------
-- 2. Ceiling only — the regression: v_rating was NULL, and the max branch was
--    guarded by IS NOT NULL, so a max_rating league admitted absolutely anyone.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_hi uuid;
    v_lid uuid; v_err text; v_raised boolean := false; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_low FROM l_players WHERE idx = 1;   -- NTRP 2.0
    SELECT id INTO v_hi  FROM l_players WHERE idx = 3;   -- NTRP 5.0
    SELECT id INTO v_org FROM l_players WHERE idx = 5;

    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, max_rating)
    VALUES ('Ceiling 3.0', v_sport, v_org, 'open', 'active', 3.0)
    RETURNING id INTO v_lid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'ceiling-only league still admits an over-rated player';
    ASSERT v_err = 'RATING_TOO_HIGH', 'expected RATING_TOO_HIGH, got ' || v_err;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'under-ceiling player expected active, got ' || v_row.status;

    RAISE NOTICE 'PASS 2: ceiling-only league now blocks over-rated players and admits the rest';
END $$;


-- --------------------------------------------------------------------------
-- 3. Floor only — the other half of the regression: with v_rating always NULL
--    the min branch rejected every player, however strong.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_mid uuid; v_hi uuid;
    v_lid uuid; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_mid FROM l_players WHERE idx = 2;   -- NTRP 4.0
    SELECT id INTO v_hi  FROM l_players WHERE idx = 3;   -- NTRP 5.0
    SELECT id INTO v_org FROM l_players WHERE idx = 5;

    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, min_rating)
    VALUES ('Floor 3.0', v_sport, v_org, 'open', 'active', 3.0)
    RETURNING id INTO v_lid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mid::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'at-floor player expected active, got ' || v_row.status;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'above-floor player expected active, got ' || v_row.status;

    RAISE NOTICE 'PASS 3: floor-only league now admits qualifying players instead of everyone failing';
END $$;


-- --------------------------------------------------------------------------
-- 4. No bounds — the helper must stay a no-op, unrated players included.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_unrated uuid; v_lid uuid; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_unrated FROM l_players WHERE idx = 4;
    SELECT id INTO v_org     FROM l_players WHERE idx = 5;

    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('No bounds', v_sport, v_org, 'open', 'active')
    RETURNING id INTO v_lid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrated::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'unrated player must still join an ungated league';

    RAISE NOTICE 'PASS 4: ungated league unaffected — unrated player still joins';
END $$;


-- --------------------------------------------------------------------------
-- 5. Organizer invites bypass the band, on purpose. The bounds gate self-serve
--    joining; an organizer naming a player has already decided they belong.
--    Deliberate divergence from tournaments (20260725120000 gates their
--    accept_invite) — if this block starts failing, someone gated league
--    invites without deciding to.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_hi uuid;
    v_lid uuid; v_lid2 uuid; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_low FROM l_players WHERE idx = 1;   -- NTRP 2.0, below floor
    SELECT id INTO v_hi  FROM l_players WHERE idx = 3;   -- NTRP 5.0, above ceiling
    SELECT id INTO v_org FROM l_players WHERE idx = 5;

    -- (a) invite_only league, below the floor, accepted → in.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, min_rating, max_rating)
    VALUES ('Invited band 3.5-4.5', v_sport, v_org, 'invite_only', 'active', 3.5, 4.5)
    RETURNING id INTO v_lid;

    INSERT INTO league_members (league_id, user_id, status, invited_by)
    VALUES (v_lid, v_low, 'pending', v_org);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    SELECT * INTO v_row FROM league_accept_invite(v_lid);
    ASSERT v_row.status = 'active',
        'invited below-floor player expected active, got ' || v_row.status;

    -- (b) approval league with a ceiling, above it, accepted → in.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, max_rating)
    VALUES ('Invited ceiling 3.0', v_sport, v_org, 'approval', 'active', 3.0)
    RETURNING id INTO v_lid2;

    INSERT INTO league_members (league_id, user_id, status, invited_by)
    VALUES (v_lid2, v_hi, 'pending', v_org);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    SELECT * INTO v_row FROM league_accept_invite(v_lid2);
    ASSERT v_row.status = 'active',
        'invited above-ceiling player expected active, got ' || v_row.status;

    RAISE NOTICE 'PASS 5: organizer invites override the band via league_accept_invite';
END $$;


-- --------------------------------------------------------------------------
-- 6. league_join accepts a pending invite (20260725140000). The branch used to
--    be unreachable: the ALREADY_MEMBER guard fired on the invitee's 'pending'
--    row first, so Join answered "ALREADY_MEMBER" to an invited player. Covers
--    the whole reordered guard block, since getting one case right by moving
--    code is easy and getting the neighbours wrong with it is easier.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_low uuid; v_mid uuid; v_hi uuid;
    v_lid uuid; v_err text; v_raised boolean; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_low FROM l_players WHERE idx = 1;   -- NTRP 2.0
    SELECT id INTO v_mid FROM l_players WHERE idx = 2;   -- NTRP 4.0
    SELECT id INTO v_hi  FROM l_players WHERE idx = 3;   -- NTRP 5.0
    SELECT id INTO v_org FROM l_players WHERE idx = 5;

    -- (a) invite_only + a band the invitee misses → accepted anyway, and
    --     logged as accept_invite so both accept paths read alike.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status, min_rating, max_rating)
    VALUES ('Join invite band', v_sport, v_org, 'invite_only', 'active', 3.5, 4.5)
    RETURNING id INTO v_lid;
    INSERT INTO league_members (league_id, user_id, status, invited_by)
    VALUES (v_lid, v_low, 'pending', v_org);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_low::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'invitee via league_join expected active, got ' || v_row.status;
    ASSERT EXISTS (SELECT 1 FROM leagues_tournaments_audit
                    WHERE entity_id = v_row.id AND action = 'accept_invite'),
        'invite accepted through league_join must audit as accept_invite';

    -- (b) invites are not an invite_only thing: league_invite_members places
    --     them on any league, and an approval-mode invitee skips approval.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('Join invite approval', v_sport, v_org, 'approval', 'active')
    RETURNING id INTO v_lid;
    INSERT INTO league_members (league_id, user_id, status, invited_by)
    VALUES (v_lid, v_mid, 'pending', v_org);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mid::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'approval-league invitee expected active, got ' || v_row.status;

    -- (c) a pending row WITHOUT invited_by is a self-request awaiting the
    --     organizer, not an invite. Must still be ALREADY_MEMBER.
    v_raised := false;
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('Join pending request', v_sport, v_org, 'approval', 'active')
    RETURNING id INTO v_lid;
    INSERT INTO league_members (league_id, user_id, status)
    VALUES (v_lid, v_mid, 'pending');

    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'a pending self-request was mistaken for an invite';
    ASSERT v_err = 'ALREADY_MEMBER', 'expected ALREADY_MEMBER, got ' || v_err;

    -- (d) invite_only with no row at all → still NOT_INVITED.
    v_raised := false;
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('Join uninvited', v_sport, v_org, 'invite_only', 'active')
    RETURNING id INTO v_lid;

    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'invite-only league was self-joinable without an invite';
    ASSERT v_err = 'NOT_INVITED', 'expected NOT_INVITED, got ' || v_err;

    -- (e) an invite also outranks a full roster, same as league_accept_invite.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status,
                         member_capacity, waitlist_enabled)
    VALUES ('Join invite full', v_sport, v_org, 'approval', 'active', 1, false)
    RETURNING id INTO v_lid;
    INSERT INTO league_members (league_id, user_id, status) VALUES (v_lid, v_mid, 'active');
    INSERT INTO league_members (league_id, user_id, status, invited_by)
    VALUES (v_lid, v_hi, 'pending', v_org);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_hi::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'invitee into a full league expected active, got ' || v_row.status;

    RAISE NOTICE 'PASS 6: league_join accepts invites; self-requests, uninvited and full cases intact';
END $$;


-- --------------------------------------------------------------------------
-- 7. The guard reorder must not have loosened ordinary joining.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid; v_org uuid; v_mid uuid; v_lid uuid;
    v_err text; v_raised boolean; v_row league_members;
BEGIN
    SELECT sport_id INTO v_sport FROM l_fix;
    SELECT id INTO v_mid FROM l_players WHERE idx = 2;
    SELECT id INTO v_org FROM l_players WHERE idx = 5;

    -- open league: join once, then again.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('Rejoin guard', v_sport, v_org, 'open', 'active')
    RETURNING id INTO v_lid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mid::text)::text, true);
    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'active', 'first join expected active, got ' || v_row.status;

    v_raised := false;
    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'an active member joined twice';
    ASSERT v_err = 'ALREADY_MEMBER', 'expected ALREADY_MEMBER, got ' || v_err;

    -- approval league: still lands pending, not active.
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status)
    VALUES ('Approval guard', v_sport, v_org, 'approval', 'active')
    RETURNING id INTO v_lid;

    SELECT * INTO v_row FROM league_join(v_lid);
    ASSERT v_row.status = 'pending', 'approval join expected pending, got ' || v_row.status;

    -- a full open league still rejects an uninvited joiner.
    v_raised := false;
    INSERT INTO leagues (name, sport_id, organizer_id, join_mode, status,
                         member_capacity, waitlist_enabled)
    VALUES ('Full guard', v_sport, v_org, 'open', 'active', 0, false)
    RETURNING id INTO v_lid;

    BEGIN
        PERFORM league_join(v_lid);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        v_err := SQLERRM; v_raised := true;
    END;
    ASSERT v_raised, 'a full league admitted an uninvited joiner';
    ASSERT v_err = 'LEAGUE_FULL', 'expected LEAGUE_FULL, got ' || v_err;

    RAISE NOTICE 'PASS 7: ordinary join paths unchanged (dupe, approval, capacity)';
END $$;

ROLLBACK;
