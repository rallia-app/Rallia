-- ============================================
-- Tournaments — player-shared invite links (DB-level)
-- ============================================
-- Covers 20260729140000_lt_player_invite_links.
--
-- Invite links used to be organizer-only because redeeming one skips
-- registration_mode and never checks the rating band. Players can now mint
-- their own link, so the whole point of these tests is that the player kind
-- does NOT inherit the skeleton-key behaviour:
--
--   * a player mints a link on a public, open tournament
--   * an organizer still gets the organizer link, not a player one
--   * a player link on an approval tournament lands the joiner in PENDING
--   * an ORGANIZER link on the same tournament still lands them REGISTERED
--   * a player link enforces the rating band (RATING_TOO_LOW)
--   * an organizer link still bypasses the band
--   * private / invite_only tournaments refuse to mint a player link
--   * removal is still not backdoorable through a player link
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_player_invite_links_test.sql
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

-- --------------------------------------------------------------------------
-- Helper: an open tournament with a configurable mode / visibility / band.
-- Players 2..n are unregistered so they can be joiners.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_tournament(
    p_name        text,
    p_mode        tournament_registration_mode DEFAULT 'open',
    p_visibility  tournament_visibility DEFAULT 'public',
    p_min_rating  numeric DEFAULT NULL,
    p_org_idx     int DEFAULT 1,
    OUT o_org     uuid,
    OUT o_players uuid[],
    OUT o_tid     uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid;
    v_t     tournaments;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    -- is_admin() bypasses the gates under test, so use non-admin fixtures.
    SELECT array_agg(player_id) INTO o_players FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 12) s;
    ASSERT array_length(o_players, 1) = 12, 'need 12 active non-admin tennis players';
    -- tournament_create rate-limits a non-admin organizer to 5 per 24h, so each
    -- test uses its own organizer. Joiners always come from index 7+, which is
    -- disjoint from every organizer slot.
    o_org := o_players[p_org_idx];

    PERFORM set_config('request.jwt.claims', json_build_object('sub', o_org::text)::text, true);
    PERFORM pg_temp.staff_on(o_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => p_name, p_sport_id => v_sport, p_max_participants => 16::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_visibility => p_visibility, p_registration_mode => p_mode);
    PERFORM pg_temp.staff_off(o_org);
    o_tid := v_t.id;
    PERFORM tournament_open_registration(o_tid, v_t.version);

    IF p_min_rating IS NOT NULL THEN
        UPDATE tournaments SET min_rating = p_min_rating WHERE id = o_tid;
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 1. a player mints a player link; the organizer still gets an organizer link
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_player_link tournament_invite_links; v_org_link tournament_invite_links;
    v_second tournament_invite_links;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — minting');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    SELECT * INTO v_player_link FROM tournament_invite_get_or_create(v_tid);
    ASSERT v_player_link.kind = 'player', 'a non-organizer must get a player link';
    ASSERT v_player_link.created_by = v_players[7], 'the sharer owns the link';

    -- Idempotent per sharer.
    SELECT * INTO v_second FROM tournament_invite_get_or_create(v_tid);
    ASSERT v_second.id = v_player_link.id, 'a sharer keeps one link, not a new one per call';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_org_link FROM tournament_invite_get_or_create(v_tid);
    ASSERT v_org_link.kind = 'organizer', 'the organizer must still get the organizer link';
    ASSERT v_org_link.id <> v_player_link.id, 'organizer and player links are distinct rows';

    RAISE NOTICE 'PASS 1: players mint their own link, organizers keep theirs';
END $$;

-- --------------------------------------------------------------------------
-- 2. approval mode: player link -> PENDING, organizer link -> REGISTERED
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_plink tournament_invite_links; v_olink tournament_invite_links;
    v_reg tournament_registrations;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — approval', 'approval', 'public', NULL, 2);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    SELECT * INTO v_plink FROM tournament_invite_get_or_create(v_tid);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_olink FROM tournament_invite_get_or_create(v_tid);

    -- Recipient of the player-shared link joins the queue.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[8]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_join_via_invite(v_plink.token, NULL);
    ASSERT v_reg.status = 'pending',
        format('player link on an approval tournament must land pending, got %s', v_reg.status);

    -- The organizer's own link keeps admitting directly.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[9]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_join_via_invite(v_olink.token, NULL);
    ASSERT v_reg.status = 'registered',
        format('organizer link must still bypass approval, got %s', v_reg.status);

    RAISE NOTICE 'PASS 2: player link queues for approval, organizer link still admits directly';
END $$;

-- --------------------------------------------------------------------------
-- 3. the rating band binds a player link but not an organizer link
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_plink tournament_invite_links; v_olink tournament_invite_links;
    v_reg tournament_registrations; v_ok boolean := false;
BEGIN
    -- 9.0 is above every seeded rating, so every joiner is out of band.
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — band', 'open', 'public', 9.0, 3);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    SELECT * INTO v_plink FROM tournament_invite_get_or_create(v_tid);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    SELECT * INTO v_olink FROM tournament_invite_get_or_create(v_tid);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[8]::text)::text, true);
    BEGIN
        PERFORM tournament_join_via_invite(v_plink.token, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'RATING_TOO_LOW'); END;
    ASSERT v_ok, 'a player link must enforce the rating band';

    -- The organizer admitting someone out-of-band is still their call.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[9]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_join_via_invite(v_olink.token, NULL);
    ASSERT v_reg.status = 'registered', 'organizer link must still bypass the band';

    RAISE NOTICE 'PASS 3: the band binds player links only';
END $$;

-- --------------------------------------------------------------------------
-- 4. private and invite_only refuse to mint a player link
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid; v_ok boolean;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — private', 'open', 'private', NULL, 4);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_invite_get_or_create(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SHARING_NOT_AVAILABLE'); END;
    ASSERT v_ok, 'a private tournament must not be shareable by a player';

    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — invite only', 'invite_only', 'public', NULL, 5);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    v_ok := false;
    BEGIN
        PERFORM tournament_invite_get_or_create(v_tid);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'SHARING_NOT_AVAILABLE'); END;
    ASSERT v_ok, 'an invite-only tournament must not be shareable by a player';

    RAISE NOTICE 'PASS 4: private and invite-only refuse player links';
END $$;

-- --------------------------------------------------------------------------
-- 5. removal is not backdoorable through a player link
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_players uuid[]; v_tid uuid;
    v_plink tournament_invite_links; v_reg tournament_registrations; v_ok boolean := false;
BEGIN
    SELECT o_org, o_players, o_tid INTO v_org, v_players, v_tid
      FROM pg_temp.mk_tournament('Player links — removal', 'open', 'public', NULL, 6);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[7]::text)::text, true);
    SELECT * INTO v_plink FROM tournament_invite_get_or_create(v_tid);

    -- Player 3 registers, then the organizer removes them.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[8]::text)::text, true);
    SELECT * INTO v_reg FROM tournament_register(v_tid, NULL);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org::text)::text, true);
    PERFORM tournament_remove_registration(v_reg.id, v_reg.version);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_players[8]::text)::text, true);
    BEGIN
        PERFORM tournament_join_via_invite(v_plink.token, NULL);
    EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM = 'REGISTRATION_REMOVED'); END;
    ASSERT v_ok, 'a removed player must not re-enter through a shared link';

    RAISE NOTICE 'PASS 5: removal survives a player-shared link';
END $$;

ROLLBACK;
