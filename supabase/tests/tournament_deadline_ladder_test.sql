-- ============================================
-- Tournaments — F4b: nudges + resolution ladder
-- ============================================
-- A free single-elim draw of 4 (the ladder is format-agnostic; single elim
-- exercises the advancement cascade) with an expired round-1 deadline:
--   * side A has effort (a chat message), side B silent → walkover for A,
--     bracket advances, loser gets tournament_unresponsive;
--   * both silent → extension NOT possible (no effort) → double walkover,
--     fed slot becomes a bye, the real opponent in the other semi advances
--     through the final normally;
--   * both with effort → one auto extension, then (expired again) double
--     walkover;
--   * attached game → grace stamps the override and nothing is forfeited;
--   * dry-run mode audits and changes nothing.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_deadline_ladder_test.sql

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

-- Build one draw-of-4 free tournament, registration in seed order.
CREATE OR REPLACE FUNCTION pg_temp.mk_t(p_org uuid, p_players uuid[], p_name text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_t   tournaments;
    v_ver integer;
BEGIN
    PERFORM pg_temp.staff_on(p_org);
    PERFORM pg_temp.as_user(p_org);
    SELECT * INTO v_t FROM public.tournament_create(
        p_name, (SELECT id FROM sport WHERE name = 'tennis'), 4::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(p_players[i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(p_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);
    RETURN v_t.id;
END;
$$;

-- Expire the round-1 deadline directly (cron-side write, bypassing the RPC's
-- future-only validation on purpose).
CREATE OR REPLACE FUNCTION pg_temp.expire_r1(p_t uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE tournament_round_deadlines
     SET deadline_at = now() - interval '1 hour'
   WHERE tournament_id = p_t AND bracket_side = 'main' AND round_number = 1;
$$;

-- The round chat for a bracket match, creating it the way the app does.
CREATE OR REPLACE FUNCTION pg_temp.say(p_tm uuid, p_user uuid, p_text text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_conv uuid;
BEGIN
    PERFORM pg_temp.as_user(p_user);
    SELECT public.get_or_create_tournament_round_chat(p_tm) INTO v_conv;
    INSERT INTO message (conversation_id, sender_id, content)
    VALUES (v_conv, p_user, p_text);
END;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_t       uuid;
    v_m1      tournament_matches;
    v_m2      tournament_matches;
    v_final   tournament_matches;
    v_cnt     integer;
    v_res     integer;
BEGIN
    v_players := pg_temp.tennis_players(9);
    v_org     := v_players[9];

    -- ============================================================ scenario 1
    -- Semi 1: player1 side messages, player2 silent → walkover for side 1.
    -- Semi 2: both silent → double walkover; the final resolves with only
    -- the semi-1 winner: they advance on the bye and become champion.
    v_t := pg_temp.mk_t(v_org, v_players, '[TEST-DL] Ladder A');
    PERFORM pg_temp.expire_r1(v_t);

    SELECT * INTO v_m1 FROM tournament_matches
     WHERE tournament_id = v_t AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_m2 FROM tournament_matches
     WHERE tournament_id = v_t AND round_number = 1 AND match_position = 2;

    PERFORM pg_temp.say(v_m1.id,
        (SELECT user_id FROM tournament_registrations WHERE id = v_m1.player1_registration_id),
        'dispo mardi soir?');

    -- Dry run first: decisions audited, nothing changes.
    SELECT public.lt_resolve_due_tournament_matches(true) INTO v_res;
    IF v_res < 2 THEN
        RAISE EXCEPTION 'dry run resolved % matches, expected >= 2', v_res;
    END IF;
    IF EXISTS (SELECT 1 FROM tournament_matches
                WHERE tournament_id = v_t AND status <> 'pending') THEN
        RAISE EXCEPTION 'dry run mutated match state';
    END IF;

    -- Live pass.
    SELECT public.lt_resolve_due_tournament_matches(false) INTO v_res;

    SELECT * INTO v_m1 FROM tournament_matches WHERE id = v_m1.id;
    IF v_m1.status <> 'walkover' OR v_m1.winner_registration_id <> v_m1.player1_registration_id THEN
        RAISE EXCEPTION 'semi 1 not walkover for the effortful side (status %, winner %)',
            v_m1.status, v_m1.winner_registration_id;
    END IF;

    SELECT * INTO v_m2 FROM tournament_matches WHERE id = v_m2.id;
    IF v_m2.status <> 'walkover' OR v_m2.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'semi 2 not a double walkover';
    END IF;

    -- Final: semi-1 winner vs a bye → auto-completed, tournament done.
    SELECT * INTO v_final FROM tournament_matches
     WHERE tournament_id = v_t AND round_number = 2;
    IF v_final.status <> 'completed'
       OR v_final.winner_registration_id <> v_m1.player1_registration_id THEN
        RAISE EXCEPTION 'final did not auto-resolve on the bye (status %)', v_final.status;
    END IF;
    IF (SELECT status FROM tournaments WHERE id = v_t) <> 'completed' THEN
        RAISE EXCEPTION 'tournament not completed after cascade';
    END IF;

    -- Reputation: 3 unresponsive events (semi-1 loser + both semi-2 sides).
    SELECT count(*) INTO v_cnt FROM reputation_event
     WHERE event_type = 'tournament_unresponsive'
       AND metadata->>'tournamentId' = v_t::text;
    IF v_cnt <> 3 THEN
        RAISE EXCEPTION 'expected 3 unresponsive events, got %', v_cnt;
    END IF;

    -- ============================================================ scenario 2
    -- Both sides show effort → one automatic extension; expire it → double
    -- walkover on the second pass.
    v_t := pg_temp.mk_t(v_org, v_players[5:8] || v_players[1:4], '[TEST-DL] Ladder B');
    PERFORM pg_temp.expire_r1(v_t);
    SELECT * INTO v_m1 FROM tournament_matches
     WHERE tournament_id = v_t AND round_number = 1 AND match_position = 1;
    PERFORM pg_temp.say(v_m1.id,
        (SELECT user_id FROM tournament_registrations WHERE id = v_m1.player1_registration_id),
        'lundi?');
    PERFORM pg_temp.say(v_m1.id,
        (SELECT user_id FROM tournament_registrations WHERE id = v_m1.player2_registration_id),
        'plutôt mercredi');

    -- Scenario 3 setup must precede the first resolver pass: attach a game
    -- to the OTHER semi so it earns grace instead of a double walkover.
    SELECT * INTO v_m2 FROM tournament_matches
     WHERE tournament_id = v_t AND round_number = 1 AND match_position = 2;
    DECLARE
        v_match_id uuid;
    BEGIN
        INSERT INTO match (sport_id, match_date, start_time, end_time, created_by)
        VALUES ((SELECT id FROM sport WHERE name = 'tennis'),
                current_date + 2, time '19:00', time '20:30',
                (SELECT user_id FROM tournament_registrations WHERE id = v_m2.player1_registration_id))
        RETURNING id INTO v_match_id;
        UPDATE tournament_matches SET match_id = v_match_id WHERE id = v_m2.id;
    END;

    PERFORM public.lt_resolve_due_tournament_matches(false);
    SELECT * INTO v_m1 FROM tournament_matches WHERE id = v_m1.id;
    IF v_m1.status <> 'pending' OR v_m1.deadline_override_at IS NULL THEN
        RAISE EXCEPTION 'both-effort match not extended (status %, override %)',
            v_m1.status, v_m1.deadline_override_at;
    END IF;

    UPDATE tournament_matches SET deadline_override_at = now() - interval '1 minute'
     WHERE id = v_m1.id;
    PERFORM public.lt_resolve_due_tournament_matches(false);
    SELECT * INTO v_m1 FROM tournament_matches WHERE id = v_m1.id;
    IF v_m1.status <> 'walkover' OR v_m1.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'spent extension did not double-walkover (status %)', v_m1.status;
    END IF;

    -- ============================================================ scenario 3
    -- The attached game earned grace on the first pass instead of a forfeit.
    SELECT * INTO v_m2 FROM tournament_matches WHERE id = v_m2.id;
    IF v_m2.status <> 'pending' OR v_m2.deadline_override_at IS NULL THEN
        RAISE EXCEPTION 'attached game was not granted grace (status %)', v_m2.status;
    END IF;
    IF v_m2.deadline_override_at < (current_date + 2 + interval '72 hours') THEN
        RAISE EXCEPTION 'grace shorter than game time + 72h';
    END IF;

    RAISE NOTICE 'tournament_deadline_ladder_test: ALL PASS';
END;
$$;

ROLLBACK;
