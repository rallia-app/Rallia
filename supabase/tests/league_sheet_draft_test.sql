-- ============================================
-- Leagues — the match sheet is a draft until the organizer publishes it
-- ============================================
-- Covers 20260820170000. The point of the change is a visibility boundary, so
-- the assertions that matter run under SET LOCAL ROLE authenticated, where RLS
-- is actually enforced; the owner role would see every row regardless.
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/league_sheet_draft_test.sql
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
    v_players uuid[];
    v_org     uuid;
    v_member  uuid;
    v_sport   uuid;
    v_league  leagues;
    v_season  seasons;
    v_sess    sessions;
    v_after   sessions;
    v_n       integer;
BEGIN
    v_players := pg_temp.tennis_players(4);
    v_org     := v_players[1];
    v_member  := v_players[2];

    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Sheet draft', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);

    PERFORM pg_temp.as_user(v_member);
    PERFORM public.league_join(v_league.id);

    PERFORM pg_temp.as_user(v_org);
    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'N1', now() + interval '3 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    -- Both confirm: the generator pairs from confirmed presence, which is
    -- exactly why the draft cannot live on the session's own status.
    PERFORM pg_temp.as_user(v_org);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');
    PERFORM pg_temp.as_user(v_member);
    PERFORM public.session_confirm_presence(v_sess.id, 'confirmed');

    PERFORM pg_temp.as_user(v_org);
    v_sess := public.session_generate_sheet(v_sess.id, v_sess.version);

    IF v_sess.sheet_published_at IS NOT NULL THEN
        RAISE EXCEPTION 'a freshly generated sheet must be a draft';
    END IF;
    RAISE NOTICE 'ok 1: generating leaves the sheet in draft';

    -- The organizer sees their own draft.
    PERFORM pg_temp.as_user(v_org);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM session_matches WHERE session_id = v_sess.id;
    RESET ROLE;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'the organizer cannot see the draft sheet they just generated';
    END IF;
    RAISE NOTICE 'ok 2: the organizer reads their draft (% rows)', v_n;

    -- The member does not.
    PERFORM pg_temp.as_user(v_member);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM session_matches WHERE session_id = v_sess.id;
    RESET ROLE;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'RLS leaked % draft sheet rows to a plain member', v_n;
    END IF;
    RAISE NOTICE 'ok 3: a member sees nothing while the sheet is a draft';

    -- A member cannot release it either.
    PERFORM pg_temp.as_user(v_member);
    BEGIN
        PERFORM public.session_publish_sheet(v_sess.id, v_sess.version);
        RAISE EXCEPTION 'a member published the sheet';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'NOT_ORGANIZER' THEN
            RAISE EXCEPTION 'expected NOT_ORGANIZER, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 4: only the organizer can publish the sheet';

    -- Publish, and the member sees the same rows the organizer does.
    PERFORM pg_temp.as_user(v_org);
    v_after := public.session_publish_sheet(v_sess.id, v_sess.version);
    IF v_after.sheet_published_at IS NULL THEN
        RAISE EXCEPTION 'publishing did not stamp the sheet';
    END IF;

    PERFORM pg_temp.as_user(v_member);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM session_matches WHERE session_id = v_sess.id;
    RESET ROLE;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'the member still cannot see a published sheet';
    END IF;
    RAISE NOTICE 'ok 5: publishing releases the sheet to the members (% rows)', v_n;

    -- Double tap is harmless and does not move the stamp members have seen.
    PERFORM pg_temp.as_user(v_org);
    v_sess := public.session_publish_sheet(v_after.id, v_after.version);
    IF v_sess.sheet_published_at <> v_after.sheet_published_at THEN
        RAISE EXCEPTION 'republishing moved the stamp';
    END IF;
    RAISE NOTICE 'ok 6: publishing an already-published sheet is a no-op';

    -- Regenerating is a new sheet, so it goes back to draft and hides again.
    PERFORM pg_temp.as_user(v_org);
    v_sess := public.session_regenerate_sheet(v_after.id, v_after.version);
    IF v_sess.sheet_published_at IS NOT NULL THEN
        RAISE EXCEPTION 'a regenerated sheet must fall back to draft';
    END IF;

    PERFORM pg_temp.as_user(v_member);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM session_matches WHERE session_id = v_sess.id;
    RESET ROLE;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'regenerating left % rows visible to a member', v_n;
    END IF;
    RAISE NOTICE 'ok 7: regenerating pulls the sheet back out of members'' hands';
END $$;

-- An empty sheet has nothing to release.
DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_sport   uuid;
    v_league  leagues;
    v_season  seasons;
    v_sess    sessions;
BEGIN
    v_players := pg_temp.tennis_players(4);
    v_org     := v_players[3];
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    v_league := public.league_create(
        p_name => 'Sheet empty', p_sport_id => v_sport, p_join_mode => 'open');
    PERFORM pg_temp.staff_off(v_org);

    v_season := public.season_create(v_league.id, 'S', current_date, current_date + 30);
    v_season := public.season_open(v_season.id, v_season.version);
    v_sess   := public.session_create(v_season.id, 'N1', now() + interval '3 days');
    v_sess   := public.session_publish(v_sess.id, NULL, v_sess.version);

    BEGIN
        PERFORM public.session_publish_sheet(v_sess.id, v_sess.version);
        RAISE EXCEPTION 'published a sheet that does not exist';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'SHEET_EMPTY' THEN
            RAISE EXCEPTION 'expected SHEET_EMPTY, got %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'ok 8: publishing an empty sheet is refused';
END $$;

ROLLBACK;
