-- ============================================
-- Scoring — games and points are two settings (DB-level)
-- ============================================
-- Covers 20260731150000_lt_points_per_game_split.
--
-- match_format fused two axes: for pickleball its labels named the POINTS that
-- win one game and said nothing about how many games are played, so best-of-3
-- to 11 — the standard format — could not be expressed. Reported as "en
-- pickleball on joue 2 de 3 a 11 points, je ne peux pas le dire".
--
--   * a pickleball tournament can be best-of-3 AND to 11 at the same time
--   * a legacy fused label passed by an old client is split, not stored
--   * pickleball gets a target by default; tennis gets none
--   * an off-list target is refused, on create and on update
--   * points_per_game is editable in draft only
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_points_per_game_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

DO $$
DECLARE
    v_pickle uuid; v_tennis uuid; v_p uuid[]; v_org uuid;
    v_t tournaments; v_err text;
BEGIN
    SELECT id INTO v_pickle FROM sport WHERE name = 'pickleball';
    SELECT id INTO v_tennis FROM sport WHERE name = 'tennis';
    ASSERT v_pickle IS NOT NULL, 'the seed must carry a pickleball sport';

    -- Organizers must play the sport (assert_caller_plays_sport).
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_pickle AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 10) s;
    ASSERT array_length(v_p, 1) >= 1, 'need an active non-admin pickleball player';
    v_org := v_p[array_length(v_p, 1)];

    PERFORM pg_temp.as_user(v_org);

    PERFORM pg_temp.staff_on(v_org);
    -- ---------------- the format the fused enum could not express ----------
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Points — best of 3 to 11', p_sport_id => v_pickle,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_match_format => 'two_of_three', p_points_per_game => 11::smallint);
    PERFORM pg_temp.staff_off(v_org);
    ASSERT v_t.match_format = 'two_of_three',
        format('the games axis must survive, got %s', v_t.match_format);
    ASSERT v_t.points_per_game = 11,
        format('the points axis must survive, got %s', v_t.points_per_game);

    PERFORM pg_temp.staff_on(v_org);
    -- ---------------- a legacy fused label is split, never stored ----------
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Points — legacy label', p_sport_id => v_pickle,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
        p_match_format => 'pickleball_to_15');
    PERFORM pg_temp.staff_off(v_org);
    ASSERT v_t.match_format = 'two_of_three',
        format('a fused label must be split, got %s', v_t.match_format);
    ASSERT v_t.points_per_game = 15,
        format('the fused target must land in its own column, got %s', v_t.points_per_game);

    PERFORM pg_temp.staff_on(v_org);
    -- ---------------- defaults per sport -----------------------------------
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Points — pickleball default', p_sport_id => v_pickle,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days');
    PERFORM pg_temp.staff_off(v_org);
    ASSERT v_t.points_per_game = 11,
        format('pickleball must default to 11, got %s', v_t.points_per_game);
    ASSERT v_t.match_format = 'two_of_three',
        format('pickleball must default to best-of-3, got %s', v_t.match_format);

    -- ---------------- an off-list target is refused ------------------------
    BEGIN
        PERFORM pg_temp.staff_on(v_org);
        PERFORM tournament_create(
            p_name => 'Points — bad target', p_sport_id => v_pickle,
            p_max_participants => 4::smallint,
            p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days',
            p_points_per_game => 9::smallint);
        PERFORM pg_temp.staff_off(v_org);
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'INVALID_POINTS_PER_GAME',
        format('an off-list target must be refused, got %s', v_err);

    -- ---------------- editable in draft, refused after ---------------------
    SELECT * INTO v_t FROM tournaments WHERE name = 'Points — best of 3 to 11';
    SELECT * INTO v_t FROM tournament_update(v_t.id, v_t.version,
        jsonb_build_object('points_per_game', 21));
    ASSERT v_t.points_per_game = 21,
        format('a draft must accept a new target, got %s', v_t.points_per_game);

    BEGIN
        PERFORM tournament_update(v_t.id, v_t.version,
            jsonb_build_object('points_per_game', 12));
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'INVALID_POINTS_PER_GAME',
        format('update must refuse an off-list target, got %s', v_err);

    SELECT * INTO v_t FROM tournament_open_registration(v_t.id, v_t.version);
    BEGIN
        PERFORM tournament_update(v_t.id, v_t.version,
            jsonb_build_object('points_per_game', 15));
        v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    ASSERT v_err = 'FIELD_NOT_EDITABLE:points_per_game',
        format('the target must lock once registration opens, got %s', v_err);

    RAISE NOTICE 'PASS: games and points are independent, legacy labels split, target validated';
END $$;

-- Tennis keeps no target of its own: its unit is games_per_set.
DO $$
DECLARE
    v_tennis uuid; v_p uuid[]; v_org uuid; v_t tournaments;
BEGIN
    SELECT id INTO v_tennis FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO v_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_tennis AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 46) s;
    v_org := v_p[41];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM tournament_create(
        p_name => 'Points — tennis', p_sport_id => v_tennis,
        p_max_participants => 4::smallint,
        p_start_date => now() + interval '7 days', p_end_date => now() + interval '8 days');
    PERFORM pg_temp.staff_off(v_org);
    ASSERT v_t.points_per_game IS NULL,
        format('tennis must carry no points target, got %s', v_t.points_per_game);

    RAISE NOTICE 'PASS: tennis carries no points target';
END $$;

ROLLBACK;
