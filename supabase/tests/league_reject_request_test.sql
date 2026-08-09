-- ============================================
-- Leagues — a turned-down join request tells the player
-- ============================================
-- Covers 20260807460000: the rejection branch in notify_league_membership_change.
-- An organizer refusing a pending self-request notifies the requester and clears
-- the organizer's own "new join request" notification; a player withdrawing
-- their own request stays silent.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_reject_request_test.sql
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

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_b       uuid;
    v_c       uuid;
    v_sport   uuid;
    v_league  leagues;
    v_member  league_members;
    v_count   integer;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    v_players := pg_temp.tennis_players(3);
    v_org := v_players[1];
    v_b   := v_players[2];
    v_c   := v_players[3];

    PERFORM pg_temp.as_user(v_org);
    v_league := public.league_create(
        p_name => 'Reject test', p_sport_id => v_sport, p_join_mode => 'approval');

    -- ------------------------------------------------------------------
    -- 1. organizer turns a request down: the requester hears about it
    -- ------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_b);
    v_member := public.league_join(v_league.id);
    IF v_member.status <> 'pending' THEN
        RAISE EXCEPTION 'expected a pending request, got %', v_member.status;
    END IF;

    -- The request notified the organizer.
    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_org AND type = 'league_member_request'
       AND payload ->> 'memberId' = v_member.id::text;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'expected the organizer request notification, found %', v_count;
    END IF;

    PERFORM pg_temp.as_user(v_org);
    PERFORM public.league_remove_member(v_member.id, v_member.version);

    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_b AND type = 'league_member_rejected' AND target_id = v_league.id;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'expected 1 rejection notification for the requester, found %', v_count;
    END IF;
    RAISE NOTICE 'ok 1: the refused requester is notified';

    -- The organizer's now-answered request notification is gone.
    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_org AND type = 'league_member_request'
       AND payload ->> 'memberId' = v_member.id::text;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'the answered request notification survived';
    END IF;
    RAISE NOTICE 'ok 2: the organizer''s request notification is cleared';

    -- ------------------------------------------------------------------
    -- 3. a player withdrawing their own request stays silent
    -- ------------------------------------------------------------------
    PERFORM pg_temp.as_user(v_c);
    v_member := public.league_join(v_league.id);
    PERFORM public.league_leave(v_league.id);

    SELECT count(*) INTO v_count FROM notification
     WHERE user_id = v_c AND type = 'league_member_rejected' AND target_id = v_league.id;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'a self-withdrawal produced a rejection notification';
    END IF;
    RAISE NOTICE 'ok 3: withdrawing your own request is silent';
END $$;

ROLLBACK;
