-- ============================================
-- Who can see a shared game's players, and how many fit in it
-- ============================================
-- Covers 20260908190205_match_participants_visible_in_shared_networks and
-- 20260908190206_match_participant_capacity_guard.
--
-- A private game shared into a community was readable by that community while
-- its match_participant rows were not, so every count of joined players read
-- zero: a full singles game advertised "2 spots left" in the chat card, the
-- detail sheet drew a third seat, and the Join button stayed live on it.
--
-- Fixture: one host, one player already in the game, one co-member of the
-- host's community, one co-member of the host's player group, one outsider who
-- shares no network with the host.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/match_shared_network_participants_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

DO $$
DECLARE
    v_p        uuid[];
    v_host     uuid;
    v_in       uuid;
    v_comm     uuid;
    v_grp      uuid;
    v_out      uuid;
    v_sport    uuid;
    v_community uuid;
    v_group    uuid;
    v_match    uuid;
    v_doubles  uuid;
    v_wait     uuid;
    v_n        int;
    v_msg      text;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    ASSERT v_sport IS NOT NULL, 'need the tennis sport row';

    -- Ordinary players only: an admin identity would answer a different
    -- question than the one under test.
    SELECT array_agg(id) INTO v_p FROM (
      SELECT p.id FROM player p
       WHERE NOT EXISTS (SELECT 1 FROM admin a WHERE a.id = p.id)
       ORDER BY p.id LIMIT 5) t;
    ASSERT array_length(v_p, 1) = 5, 'need five non-admin players';
    v_host := v_p[1]; v_in := v_p[2]; v_comm := v_p[3]; v_grp := v_p[4]; v_out := v_p[5];

    -- The outsider must share nothing with the host, or the policy under test
    -- would pass for the wrong reason.
    DELETE FROM network_member WHERE player_id = v_out;

    INSERT INTO network (network_type_id, name, created_by)
    VALUES ((SELECT id FROM network_type WHERE name = 'community'),
            '[TEST-SN] Community', v_host)
    RETURNING id INTO v_community;

    INSERT INTO network (network_type_id, name, created_by)
    VALUES ((SELECT id FROM network_type WHERE name = 'player_group'),
            '[TEST-SN] Group', v_host)
    RETURNING id INTO v_group;

    -- Creating a network already seats its creator, hence the upsert.
    INSERT INTO network_member (network_id, player_id, status)
    VALUES (v_community, v_host, 'active'), (v_community, v_comm, 'active'),
           (v_group,     v_host, 'active'), (v_group,     v_grp,  'active')
    ON CONFLICT (network_id, player_id) DO UPDATE SET status = 'active';

    -- A private singles game shared into communities only. create_host_participant
    -- seats the host; v_in takes the other seat, so the game is full.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time,
                       timezone, format, visibility,
                       visible_in_communities, visible_in_groups)
    VALUES (v_sport, v_host, current_date + 3, '18:00', '19:30',
            'America/Toronto', 'singles', 'private', true, false)
    RETURNING id INTO v_match;

    INSERT INTO match_participant (match_id, player_id, status, joined_at)
    VALUES (v_match, v_in, 'joined', now());

    SELECT count(*) INTO v_n FROM match_participant
     WHERE match_id = v_match AND status = 'joined';
    ASSERT v_n = 2, 'fixture: the singles game should be full, got ' || v_n;

    -- ── 1. the community sees the game AND who is in it ──────────────────────
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM match WHERE id = v_match;
    ASSERT v_n = 1, 'community member cannot see the shared game at all';
    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_match;
    ASSERT v_n = 2, 'community member sees ' || v_n || ' participants, expected 2';
    RESET ROLE;

    -- ── 2. an outsider still sees neither ────────────────────────────────────
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_out, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM match WHERE id = v_match;
    ASSERT v_n = 0, 'RLS leaked a private game to a stranger';
    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_match;
    ASSERT v_n = 0, 'RLS leaked participants to a stranger';
    RESET ROLE;

    -- ── 3. the group toggle is read on its own ───────────────────────────────
    UPDATE match SET visible_in_communities = false, visible_in_groups = true
     WHERE id = v_match;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_match;
    ASSERT v_n = 0, 'community kept seeing participants after sharing was turned off';
    RESET ROLE;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_grp, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_match;
    ASSERT v_n = 2, 'group member sees ' || v_n || ' participants, expected 2';
    RESET ROLE;

    -- ── 4. a game shared nowhere stays private to its players ────────────────
    UPDATE match SET visible_in_groups = false WHERE id = v_match;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_grp, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM match_participant WHERE match_id = v_match;
    ASSERT v_n = 0, 'unshared private game leaked its participants';
    RESET ROLE;

    UPDATE match SET visible_in_communities = true WHERE id = v_match;

    -- ── 5. the seats are enforced in the database ────────────────────────────
    BEGIN
        INSERT INTO match_participant (match_id, player_id, status, joined_at)
        VALUES (v_match, v_comm, 'joined', now());
        RAISE EXCEPTION 'a third player joined a singles game';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'MATCH_FULL', 'third join: got ' || v_msg;
    END;

    -- ── 6. a full game still takes requests and a waitlist ───────────────────
    INSERT INTO match_participant (match_id, player_id, status)
    VALUES (v_match, v_comm, 'waitlisted')
    RETURNING id INTO v_wait;

    INSERT INTO match_participant (match_id, player_id, status)
    VALUES (v_match, v_grp, 'requested');

    -- ...and refuses to promote off it while every seat is taken.
    BEGIN
        UPDATE match_participant SET status = 'joined' WHERE id = v_wait;
        RAISE EXCEPTION 'promoted a waitlisted player into a full game';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'MATCH_FULL', 'waitlist promotion: got ' || v_msg;
    END;

    -- ── 7. a seat opens and the same promotion goes through ──────────────────
    UPDATE match_participant SET status = 'left'
     WHERE match_id = v_match AND player_id = v_in;
    UPDATE match_participant SET status = 'joined' WHERE id = v_wait;

    SELECT count(*) INTO v_n FROM match_participant
     WHERE match_id = v_match AND status = 'joined';
    ASSERT v_n = 2, 'after promotion the game should hold 2, got ' || v_n;

    -- Re-stamping a seated player must not be read as taking a second seat.
    UPDATE match_participant SET status = 'joined' WHERE id = v_wait;

    -- ── 8. doubles gets four ─────────────────────────────────────────────────
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time,
                       timezone, format, visibility)
    VALUES (v_sport, v_host, current_date + 4, '18:00', '19:30',
            'America/Toronto', 'doubles', 'private')
    RETURNING id INTO v_doubles;

    INSERT INTO match_participant (match_id, player_id, status, joined_at)
    VALUES (v_doubles, v_in, 'joined', now()),
           (v_doubles, v_comm, 'joined', now()),
           (v_doubles, v_grp, 'joined', now());

    SELECT count(*) INTO v_n FROM match_participant
     WHERE match_id = v_doubles AND status = 'joined';
    ASSERT v_n = 4, 'doubles should seat 4, got ' || v_n;

    BEGIN
        INSERT INTO match_participant (match_id, player_id, status, joined_at)
        VALUES (v_doubles, v_out, 'joined', now());
        RAISE EXCEPTION 'a fifth player joined a doubles game';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        ASSERT v_msg = 'MATCH_FULL', 'fifth join: got ' || v_msg;
    END;

    RAISE NOTICE 'match_shared_network_participants_test: all assertions passed';
END $$;

ROLLBACK;
