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
--   * an odd roster still sits exactly one player per round under avoid_repeat
--   * in doubles, avoid_repeat rotates PARTNERS (adjacency is a team there)
--   * when every pairing has already happened, repeats are forced rather than
--     players dropped (greedy reduces repeats, it does not forbid them)
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

-- Doubles: each side of a match is a two-player TEAM; a normalized 'a~b' per
-- team lets partnerships be compared across nights.
CREATE OR REPLACE FUNCTION pg_temp.partnerships_of(p_sid uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT coalesce(array_agg(t ORDER BY t), ARRAY[]::text[])
      FROM (
        SELECT least(team[1]::text, team[2]::text) || '~' ||
               greatest(team[1]::text, team[2]::text) AS t
          FROM session_matches,
               LATERAL (VALUES (team_a_user_ids), (team_b_user_ids)) AS s(team)
         WHERE session_id = p_sid
      ) q;
$$;

-- Like mk_season, but the season can carry a rules override (doubles).
CREATE OR REPLACE FUNCTION pg_temp.mk_season2(
    p_name    text,
    p_org_idx int,
    p_rules   jsonb,
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
    SELECT * INTO v_s FROM season_create(v_l.id, 'S', current_date, current_date + 90,
        p_rules_override => p_rules);
    SELECT * INTO v_s FROM season_open(v_s.id, v_s.version);
    o_sea := v_s.id;
END $$;

-- Like mk_session, but the confirming range and round count are parameters.
CREATE OR REPLACE FUNCTION pg_temp.mk_session2(
    p_sea    uuid,
    p_name   text,
    p_mode   pairing_mode,
    p_org    uuid,
    p_p      uuid[],
    p_lo     int,
    p_hi     int,
    p_rounds smallint DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_sess sessions; v_i int;
BEGIN
    PERFORM pg_temp.as_user(p_org);
    SELECT * INTO v_sess FROM session_create(
        p_sea, p_name, now() + interval '3 days',
        p_rounds => p_rounds, p_pairing_mode => p_mode);
    SELECT * INTO v_sess FROM session_publish(v_sess.id, NULL, v_sess.version);

    FOR v_i IN p_lo..p_hi LOOP
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

-- --------------------------------------------------------------------------
-- 4. odd roster: avoid_repeat still sits exactly one player
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_one uuid; v_two uuid;
    v_matches int; v_playing int;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season2('Pairing — odd roster', 4, NULL);

    -- 7 confirmed. Night one seeds history, night two reorders around it; the
    -- bye must keep coming out of the bye queue, not out of the reordering.
    v_one := pg_temp.mk_session2(v_sea, 'odd night one', 'by_rank', v_org, v_p, 31, 37);
    v_two := pg_temp.mk_session2(v_sea, 'odd night two', 'avoid_repeat', v_org, v_p, 31, 37);

    SELECT count(*) INTO v_matches FROM session_matches WHERE session_id = v_two;
    ASSERT v_matches = 3, format('7 confirmed must produce 3 matches, got %s', v_matches);

    SELECT count(DISTINCT u) INTO v_playing
      FROM session_matches, unnest(team_a_user_ids || team_b_user_ids) AS u
     WHERE session_id = v_two;
    ASSERT v_playing = 6, format('exactly one player must sit, got %s playing', v_playing);

    RAISE NOTICE 'PASS: an odd roster under avoid_repeat still byes exactly one player';
END $$;

-- --------------------------------------------------------------------------
-- 5. doubles: adjacency is a PARTNERSHIP, so avoid_repeat rotates partners
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_one uuid; v_two uuid;
    v_repeats int; v_teams int;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season2('Pairing — doubles', 5,
          '{"formatsAllowed":["doubles"]}'::jsonb);

    -- Night one by_rank partners rank-adjacently (1&2, 3&4, ...). Night two
    -- avoid_repeat counts co-presence in a match — partner or opponent — so the
    -- chain reaches for players who have not shared a court yet, and no night-
    -- one partnership should survive on an 8-player roster with one night of
    -- history.
    v_one := pg_temp.mk_session2(v_sea, 'doubles night one', 'by_rank', v_org, v_p, 31, 38);
    v_two := pg_temp.mk_session2(v_sea, 'doubles night two', 'avoid_repeat', v_org, v_p, 31, 38);

    SELECT count(*) INTO v_teams
      FROM unnest(pg_temp.partnerships_of(v_two)) AS t;
    ASSERT v_teams = 4, format('8 confirmed doubles players must form 4 teams, got %s', v_teams);

    SELECT count(*) INTO v_repeats
      FROM unnest(pg_temp.partnerships_of(v_one)) AS t
     WHERE t = ANY (pg_temp.partnerships_of(v_two));
    ASSERT v_repeats = 0,
        format('avoid_repeat kept %s of night one''s partnerships', v_repeats);

    RAISE NOTICE 'PASS: doubles avoid_repeat hands everyone a fresh partner';
END $$;

-- --------------------------------------------------------------------------
-- 6. exhausted history: repeats are forced, players are never dropped
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_org uuid; v_p uuid[]; v_sea uuid; v_one uuid; v_two uuid;
    v_matches int;
BEGIN
    SELECT o_org, o_p, o_sea INTO v_org, v_p, v_sea
      FROM pg_temp.mk_season2('Pairing — exhausted', 6, NULL);

    -- 4 players, 3 rounds: the round-robin rotation makes everyone meet
    -- everyone in one night. Night two has no unmet opponent to reach for —
    -- the documented greedy limit — and the failure mode to rule out is the
    -- generator dropping players rather than accepting a repeat.
    v_one := pg_temp.mk_session2(v_sea, 'rr night', 'by_rank', v_org, v_p, 31, 34, 3::smallint);

    ASSERT (SELECT count(*) FROM session_matches WHERE session_id = v_one) = 6,
        '4 players over 3 rounds must produce 6 matches (full round robin)';

    v_two := pg_temp.mk_session2(v_sea, 'forced repeat night', 'avoid_repeat', v_org, v_p, 31, 34);

    SELECT count(*) INTO v_matches FROM session_matches WHERE session_id = v_two;
    ASSERT v_matches = 2,
        format('with history exhausted the roster must still fully pair, got %s matches', v_matches);

    RAISE NOTICE 'PASS: exhausted history forces repeats instead of dropping players';
END $$;

ROLLBACK;
