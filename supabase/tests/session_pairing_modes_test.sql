-- ============================================
-- Leagues — pairing_mode actually changes the sheet (DB-level)
-- ============================================
-- Covers 20260731120000_lt_session_pairing_modes.
--
-- lt_run_session_sheet never read sessions.pairing_mode and contained no
-- randomness, so all five modes produced the same ranking-ordered sheet and
-- regenerating an unchanged roster reproduced the previous pairings exactly.
-- Reported as "j'ai regenere la feuille et j'ai eu exactement les memes
-- matchs".
--
--   * by_rank is stable: regenerating an unchanged roster reproduces the sheet
--   * random reshuffles: regenerating produces a different sheet
--   * avoid_repeat prefers opponents this roster has not already faced
--   * every mode still pairs the whole roster (nobody is dropped)
--
-- Run against a fresh local stack:
--   npm run db:reset && npm run db:seed
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/session_pairing_modes_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
END $$;

-- The sheet as a comparable value: the set of pairings, each side-normalized so
-- "a vs b" and "b vs a" are the same pairing.
CREATE OR REPLACE FUNCTION pg_temp.sheet_of(p_sid uuid) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT coalesce(string_agg(p, '|' ORDER BY p), '')
      FROM (
        SELECT least(team_a_user_ids[1]::text, team_b_user_ids[1]::text) || '~' ||
               greatest(team_a_user_ids[1]::text, team_b_user_ids[1]::text) AS p
          FROM session_matches WHERE session_id = p_sid
      ) s;
$$;

-- --------------------------------------------------------------------------
-- Helpers: an open season with 8 members, then any number of published
-- sessions inside it, each generated once under a requested pairing mode.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.mk_season(
    p_name    text,
    p_org_idx int,
    OUT o_org uuid,
    OUT o_p   uuid[],
    OUT o_sea uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sport uuid; v_l leagues; v_s seasons; v_i int;
BEGIN
    SELECT id INTO v_sport FROM sport WHERE name = 'tennis';
    SELECT array_agg(player_id) INTO o_p FROM (
        SELECT player_id FROM player_sport
         WHERE sport_id = v_sport AND is_active = true AND NOT public.is_admin(player_id)
         ORDER BY player_id LIMIT 46) s;
    ASSERT array_length(o_p, 1) = 46, 'need 46 active non-admin tennis players';
    -- league_create allows a non-admin 5 leagues per 24h and the rest of the
    -- league suite organizes from the head of this same ordered pool; taking
    -- the tail keeps this file from spending their quota.
    o_org := o_p[39 + p_org_idx];

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_l FROM league_create(
        p_name => p_name, p_sport_id => v_sport,
        p_visibility => 'public', p_join_mode => 'open');
    FOR v_i IN 31..38 LOOP
        PERFORM pg_temp.as_user(o_p[v_i]);
        PERFORM league_join(v_l.id);
    END LOOP;

    PERFORM pg_temp.as_user(o_org);
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date + 90);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    o_sea := v_s.id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_session(
    p_sea  uuid,
    p_name text,
    p_mode pairing_mode,
    p_org  uuid,
    p_p    uuid[]
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_sess sessions; v_i int;
BEGIN
    PERFORM pg_temp.as_user(p_org);
    SELECT * INTO v_sess FROM session_create(
        p_sea, p_name, now() + interval '3 days', p_pairing_mode => p_mode);
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN 31..38 LOOP
        PERFORM pg_temp.as_user(p_p[v_i]);
        PERFORM session_confirm_presence(v_sess.id, 'confirmed');
    END LOOP;

    PERFORM pg_temp.as_user(p_org);
    SELECT * INTO v_sess FROM sessions WHERE id = v_sess.id;
    PERFORM session_generate_sheet(v_sess.id, v_sess.version);
    RETURN v_sess.id;
END $$;

-- --------------------------------------------------------------------------
-- 1. by_rank stays stable, which is what makes it a seeded mode
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_sid uuid; v_v int;
    v_before text; v_after text;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season('Pairing — by_rank', 1);
    v_sid := pg_temp.mk_session(v_sea, 'by_rank night', 'by_rank', v_org, v_p);

    v_before := pg_temp.sheet_of(v_sid);
    ASSERT v_before <> '', 'the first generation must produce matches';
    ASSERT (SELECT count(*) FROM session_matches WHERE session_id = v_sid) = 4,
        '8 confirmed singles players must produce 4 pairings';

    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_v FROM sessions WHERE id = v_sid;
    PERFORM session_regenerate_sheet(v_sid, v_v);

    v_after := pg_temp.sheet_of(v_sid);
    ASSERT v_after = v_before,
        'by_rank on an unchanged roster must reproduce the same sheet';

    RAISE NOTICE 'PASS: by_rank is stable across regeneration';
END $$;

-- --------------------------------------------------------------------------
-- 2. random reshuffles — the reported bug
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_sid uuid; v_v int;
    v_first text; v_now text; v_changed boolean := false; v_i int;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season('Pairing — random', 2);
    v_sid := pg_temp.mk_session(v_sea, 'random night', 'random', v_org, v_p);

    v_first := pg_temp.sheet_of(v_sid);

    -- 8 players give 105 distinct pairings of 4 matches, so a run that lands on
    -- the same one is possible; five tries makes a false red effectively
    -- impossible while still failing hard against the old no-op generator.
    FOR v_i IN 1..5 LOOP
        PERFORM pg_temp.as_user(v_org);
        SELECT version INTO v_v FROM sessions WHERE id = v_sid;
        PERFORM session_regenerate_sheet(v_sid, v_v);
        v_now := pg_temp.sheet_of(v_sid);
        IF v_now <> v_first THEN v_changed := true; EXIT; END IF;
    END LOOP;

    ASSERT v_changed, 'random must be able to produce a different sheet';
    ASSERT (SELECT count(*) FROM session_matches WHERE session_id = v_sid) = 4,
        'shuffling must not drop anyone from the sheet';

    RAISE NOTICE 'PASS: random reshuffles on regeneration';
END $$;

-- --------------------------------------------------------------------------
-- 3. avoid_repeat steers a second night away from the first night's pairings
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_one uuid; v_two uuid; v_repeats int;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season('Pairing — avoid_repeat', 3);

    -- Night one seeds the history. Night two runs the same roster, and this is
    -- exactly the case the old generator got wrong: an unchanged roster in an
    -- unchanged standing reproduced night one's pairings verbatim.
    v_one := pg_temp.mk_session(v_sea, 'night one', 'by_rank', v_org, v_p);
    v_two := pg_temp.mk_session(v_sea, 'night two', 'avoid_repeat', v_org, v_p);

    ASSERT (SELECT count(*) FROM session_matches WHERE session_id = v_two) = 4,
        'avoid_repeat must still pair the whole roster';

    SELECT count(*) INTO v_repeats
      FROM session_matches a
      JOIN session_matches b
        ON b.session_id = v_two
       AND ((a.team_a_user_ids[1] = ANY (b.team_a_user_ids)
             AND a.team_b_user_ids[1] = ANY (b.team_b_user_ids))
         OR (a.team_a_user_ids[1] = ANY (b.team_b_user_ids)
             AND a.team_b_user_ids[1] = ANY (b.team_a_user_ids)))
     WHERE a.session_id = v_one;

    ASSERT v_repeats = 0,
        format('avoid_repeat reused %s of night one''s pairings', v_repeats);

    RAISE NOTICE 'PASS: avoid_repeat gives a fresh set of opponents on night two';
END $$;

ROLLBACK;
