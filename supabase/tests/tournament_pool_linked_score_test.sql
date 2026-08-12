-- ============================================
-- Tournaments — pool_knockout: a pool game linked to a REAL match
-- ============================================
-- formats/poules-puis-eliminatoires.md §6 makes the normal score path the
-- primary one for pool games: the pairing is attached to a real Rallia match,
-- one player enters the score, the opponent confirms. Every other pool test
-- settles through the organizer override (score text only), so the branch of
-- tournament_pool_standings that reads sets and games out of the linked
-- verified match_result was never exercised.
--
-- It also pins the visibility fix. tournament_pool_standings used to run
-- SECURITY INVOKER, and match_result's SELECT policy only admits that match's
-- own participants. So the set and game counters silently read 0 for anyone
-- who was not in the game — including the organizer — while
-- tournament_generate_knockout, being SECURITY DEFINER, read the true
-- numbers and seeded the bracket from them. Standings on screen could
-- therefore rank players differently from the standings that decided who
-- qualified. The function is now SECURITY DEFINER with the tmatches_select
-- visibility rule enforced in its body, so this test asserts that three
-- different callers all see identical numbers.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_pool_linked_score_test.sql
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

-- Event creation went staff-only in 20260812150000 ("Rallia runs every event
-- during this phase"), so the create RPC now refuses a plain player. These
-- tests still drive everything AFTER creation as an ordinary organizer, so
-- staff is granted around the create calls and dropped again before the block
-- ends. It has to be dropped: pg_temp.tennis_players() filters admins out, so
-- a lingering row would shift every fixture picked by a later block.
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

-- One registration's sets/games as seen by a given caller.
CREATE OR REPLACE FUNCTION pg_temp.seen(p_caller uuid, p_t uuid, p_reg uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_out text;
BEGIN
    PERFORM pg_temp.as_user(p_caller);
    SELECT ps.sets_won || '-' || ps.sets_lost || ' / ' || ps.games_won || '-' || ps.games_lost
      INTO v_out
      FROM public.tournament_pool_standings(p_t) ps
     WHERE ps.registration_id = p_reg;
    RETURN coalesce(v_out, 'NO ROW');
END;
$$;

DO $$
DECLARE
    v_players   uuid[];
    v_organizer uuid;
    v_t         tournaments;
    v_ver       integer;
    v_tm        tournament_matches;
    v_match_id  uuid;
    v_mr_id     uuid;
    v_sport     uuid;
    v_u1        uuid;
    v_u2        uuid;
    v_u3        uuid;
    v_reg1      uuid;
    v_reg2      uuid;
    v_as_p1     text;
    v_as_p3     text;
    v_as_org    text;
    v_outsider  uuid;
BEGIN
    v_sport     := (SELECT id FROM sport WHERE name = 'tennis');
    v_players   := pg_temp.tennis_players(10);
    v_organizer := v_players[9];
    v_outsider  := v_players[10];

    PERFORM pg_temp.staff_on(v_organizer);

    PERFORM pg_temp.as_user(v_organizer);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-PK] Linked score', v_sport, 8::smallint,
        now() + interval '7 days', now() + interval '21 days',
        p_bracket_type => 'pool_knockout', p_visibility => 'private');
    PERFORM pg_temp.staff_off(v_organizer);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_organizer);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    -- Any pool pairing will do; take the first and read off its two players.
    SELECT * INTO v_tm FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool'
     ORDER BY pool_number, round_number, match_position LIMIT 1;
    v_reg1 := v_tm.player1_registration_id;
    v_reg2 := v_tm.player2_registration_id;
    SELECT user_id INTO v_u1 FROM tournament_registrations WHERE id = v_reg1;
    SELECT user_id INTO v_u2 FROM tournament_registrations WHERE id = v_reg2;
    -- A registrant in the tournament who is NOT in this game.
    SELECT tr.user_id INTO v_u3 FROM tournament_registrations tr
     WHERE tr.tournament_id = v_t.id AND tr.user_id NOT IN (v_u1, v_u2)
     LIMIT 1;

    -- The real game: player 1 beats player 2, 6-3 6-4, confirmed.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time, format)
    VALUES (v_sport, v_u1, (now() - interval '1 day')::date, '10:00', '11:00', 'singles')
    RETURNING id INTO v_match_id;
    INSERT INTO match_participant (match_id, player_id, status)
    VALUES (v_match_id, v_u1, 'joined'), (v_match_id, v_u2, 'joined')
    ON CONFLICT (match_id, player_id) DO UPDATE SET status = 'joined';

    PERFORM pg_temp.as_user(v_u1);
    SELECT public.submit_match_result_for_match(
        v_match_id, v_u1, 1,
        '[{"team1_score": 6, "team2_score": 3}, {"team1_score": 6, "team2_score": 4}]'::jsonb
    ) INTO v_mr_id;
    UPDATE match_result SET is_verified = true, confirmed_by = v_u2 WHERE id = v_mr_id;

    -- Attach: the pool row settles through the normal path, not an override.
    PERFORM pg_temp.as_user(v_u1);
    PERFORM public.tournament_attach_match(v_tm.id, v_match_id);

    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    IF v_tm.status <> 'completed' THEN
        RAISE EXCEPTION 'pool game did not complete on attach (status=%)', v_tm.status;
    END IF;
    IF v_tm.winner_registration_id <> v_reg1 THEN
        RAISE EXCEPTION 'wrong winner propagated to the pool row';
    END IF;
    IF v_tm.match_id IS NULL THEN
        RAISE EXCEPTION 'pool row is not linked to the real match';
    END IF;

    -- Sets and games must come out of the linked match_result, not the score
    -- text: 6-3 6-4 → 2-0 in sets, 12-7 in games for the winner.
    v_as_p1  := pg_temp.seen(v_u1, v_t.id, v_reg1);
    IF v_as_p1 <> '2-0 / 12-7' THEN
        RAISE EXCEPTION 'winner stats from linked match wrong: % (want 2-0 / 12-7)', v_as_p1;
    END IF;
    IF pg_temp.seen(v_u1, v_t.id, v_reg2) <> '0-2 / 7-12' THEN
        RAISE EXCEPTION 'loser stats from linked match wrong: %',
            pg_temp.seen(v_u1, v_t.id, v_reg2);
    END IF;

    -- Same numbers for a registrant who was not in the game, and for the
    -- organizer, who is not a match participant either. Before the fix both
    -- read 0-0 / 0-0 because match_result was invisible to them.
    v_as_p3  := pg_temp.seen(v_u3, v_t.id, v_reg1);
    v_as_org := pg_temp.seen(v_organizer, v_t.id, v_reg1);
    IF v_as_p3 <> v_as_p1 THEN
        RAISE EXCEPTION 'non-participant registrant sees % but participant sees %',
            v_as_p3, v_as_p1;
    END IF;
    IF v_as_org <> v_as_p1 THEN
        RAISE EXCEPTION 'organizer sees % but participant sees %', v_as_org, v_as_p1;
    END IF;

    -- The visibility rule still holds: a stranger to a private tournament is
    -- refused rather than served an empty table.
    BEGIN
        PERFORM pg_temp.seen(v_outsider, v_t.id, v_reg1);
        RAISE EXCEPTION 'expected NOT_VISIBLE for a non-registrant';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'NOT_VISIBLE' THEN RAISE; END IF;
    END;

    RAISE NOTICE 'tournament_pool_linked_score_test: ALL PASS';
END;
$$;

ROLLBACK;
