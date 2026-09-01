-- ============================================
-- Tournaments — every ladder decision tells both sides why
-- ============================================
-- An 8-draw with an expired round-1 deadline, one rung per pairing:
--   m1  one_sided  → walkover, and the two sides get DIFFERENT reasons
--   m2  no_effort  → double forfeit, which notified nobody in the v2 ladder
--   m3  stalemate  → cancelled, which has never notified anyone
-- Then the restore control: who may see it, and that it stops offering itself
-- once the decision has been undone.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_decision_reasons_test.sql

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

-- hours drives the volume signal; equal answers on both sides is what makes a
-- stalemate rather than a gap.
CREATE OR REPLACE FUNCTION pg_temp.gate(p_t uuid, p_reg uuid, p_state text, p_hours int DEFAULT 12)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, 'main', 1, u,
         CASE WHEN p_state = 'engaged' THEN 'edited' ELSE 'skipped' END,
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = 'main')
         + CASE WHEN p_state = 'engaged' THEN interval '1 hour' ELSE interval '5 days' END,
         CASE WHEN p_state = 'engaged' THEN p_hours ELSE 0 END,
         CASE WHEN p_state = 'engaged'
              THEN '[{"day":"monday","hour":18}]'::jsonb ELSE '[]'::jsonb END
    FROM unnest(public.lt_registration_users(p_reg)) u
  ON CONFLICT (tournament_id, bracket_side, round_number, player_id) DO UPDATE
    SET hours_in_window = EXCLUDED.hours_in_window, outcome = EXCLUDED.outcome,
        responded_at = EXCLUDED.responded_at;
$$;

CREATE OR REPLACE FUNCTION pg_temp.notifs(p_tm uuid, p_type text)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM notification
   WHERE type::text = p_type AND (payload ->> 'tournamentMatchId')::uuid = p_tm;
$$;

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_ver     integer;
    v_m       tournament_matches[];
    v_row     tournament_matches;
    v_i       integer;
    v_cnt     integer;
    v_win     text;
    v_lose    text;
    v_state   jsonb;
BEGIN
    v_players := pg_temp.tennis_players(9);
    v_org     := v_players[9];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-DR] Reasons', (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(v_org);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR v_i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_players[v_i]);
        PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;
    UPDATE tournament_matches
       SET deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE tournament_id = v_t.id AND round_number = 1;

    SELECT array_agg(tm ORDER BY tm.match_position) INTO v_m
      FROM tournament_matches tm
     WHERE tm.tournament_id = v_t.id AND tm.round_number = 1;

    -- m1: one tried, one did not.
    PERFORM pg_temp.gate(v_t.id, v_m[1].player1_registration_id, 'engaged');
    PERFORM pg_temp.gate(v_t.id, v_m[1].player2_registration_id, 'passive');
    -- m2: both tried, identically, so nothing separates them. Both must also
    -- have REACHED OUT, or this is the no-attempt case now and a knockout
    -- pairing goes to the organizer instead of being cancelled.
    -- A cancellation advances nobody, which is what keeps m1's restore window
    -- open: m1 and m2 feed the same semi, and a double forfeit there would
    -- propagate a walkover into it and close the window (correctly).
    PERFORM pg_temp.gate(v_t.id, v_m[2].player1_registration_id, 'engaged', 12);
    PERFORM pg_temp.gate(v_t.id, v_m[2].player2_registration_id, 'engaged', 12);
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament_match', v_m[2].id, 'funnel_pinged', u, '{}'::jsonb
      FROM unnest(public.lt_registration_users(v_m[2].player1_registration_id)
               || public.lt_registration_users(v_m[2].player2_registration_id)) u;
    -- m3, in the other half: neither did anything, both aware.
    PERFORM pg_temp.gate(v_t.id, v_m[3].player1_registration_id, 'passive');
    PERFORM pg_temp.gate(v_t.id, v_m[3].player2_registration_id, 'passive');

    PERFORM public.lt_resolve_due_tournament_matches(false);

    -- ---------------------------------------------------------- m1 one_sided
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m[1].id;
    IF v_row.status <> 'walkover' OR v_row.winner_registration_id IS NULL THEN
        RAISE EXCEPTION 'm1 expected a walkover with a winner, got % / %',
                        v_row.status, v_row.winner_registration_id;
    END IF;
    IF pg_temp.notifs(v_m[1].id, 'tournament_match_walkover') <> 2 THEN
        RAISE EXCEPTION 'm1 expected both sides notified, got %',
                        pg_temp.notifs(v_m[1].id, 'tournament_match_walkover');
    END IF;
    SELECT count(*) INTO v_cnt FROM notification
     WHERE (payload ->> 'tournamentMatchId')::uuid = v_m[1].id
       AND payload ->> 'rule' = 'one_sided';
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'm1 notifications should carry the rule, got % of 2', v_cnt;
    END IF;
    -- The whole point: the two sides are told different things.
    SELECT n.body INTO v_win FROM notification n
     WHERE (n.payload ->> 'tournamentMatchId')::uuid = v_m[1].id
       AND n.user_id = ANY (public.lt_registration_users(v_row.winner_registration_id));
    SELECT n.body INTO v_lose FROM notification n
     WHERE (n.payload ->> 'tournamentMatchId')::uuid = v_m[1].id
       AND NOT (n.user_id = ANY (public.lt_registration_users(v_row.winner_registration_id)));
    IF v_win IS NULL OR v_lose IS NULL OR v_win = v_lose THEN
        RAISE EXCEPTION 'winner and loser must get different reasons, got %% vs %%: % / %',
                        v_win, v_lose;
    END IF;

    -- ------------------------------------------- m3 no_effort (the regression)
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m[3].id;
    IF v_row.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'm3 expected a double forfeit, got a winner';
    END IF;
    IF pg_temp.notifs(v_m[3].id, 'tournament_match_walkover') <> 2 THEN
        RAISE EXCEPTION 'a double forfeit must notify both sides, got %',
                        pg_temp.notifs(v_m[3].id, 'tournament_match_walkover');
    END IF;
    SELECT count(*) INTO v_cnt FROM notification
     WHERE (payload ->> 'tournamentMatchId')::uuid = v_m[3].id
       AND (payload ->> 'double')::boolean AND payload ->> 'rule' = 'no_effort';
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'm3 notifications should say double + no_effort, got %', v_cnt;
    END IF;

    -- --------------------------------------------------------- m2 stalemate
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m[2].id;
    IF v_row.status <> 'cancelled' THEN
        RAISE EXCEPTION 'm2 expected cancelled, got %', v_row.status;
    END IF;
    IF pg_temp.notifs(v_m[2].id, 'tournament_match_cancelled') <> 2 THEN
        RAISE EXCEPTION 'a cancellation must notify both sides, got %',
                        pg_temp.notifs(v_m[2].id, 'tournament_match_cancelled');
    END IF;
    -- and never as a walkover, which would name a loser where there is none.
    IF pg_temp.notifs(v_m[2].id, 'tournament_match_walkover') <> 0 THEN
        RAISE EXCEPTION 'a cancellation must not be sent as a walkover';
    END IF;

    -- ------------------------------------------------------- the restore state
    PERFORM pg_temp.as_user(v_org);
    v_state := public.lt_match_restore_state(v_m[1].id);
    IF NOT (v_state->>'decided')::boolean OR NOT (v_state->>'restorable')::boolean
       OR v_state->>'rule' <> 'one_sided' THEN
        RAISE EXCEPTION 'organizer should be offered the restore, got %', v_state;
    END IF;

    -- A player in the pairing is not the organizer and may not undo it.
    PERFORM pg_temp.as_user(v_players[1]);
    v_state := public.lt_match_restore_state(v_m[1].id);
    IF (v_state->>'restorable')::boolean THEN
        RAISE EXCEPTION 'a participant must not be offered the restore, got %', v_state;
    END IF;

    PERFORM pg_temp.as_user(v_org);
    PERFORM public.lt_restore_tournament_match(v_m[1].id);
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m[1].id;
    IF v_row.status <> 'pending' OR v_row.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'restore should return the pairing to pending, got %', v_row.status;
    END IF;

    -- Once undone it must stop offering itself, or the organizer restores a
    -- pairing that is already back to pending.
    v_state := public.lt_match_restore_state(v_m[1].id);
    IF (v_state->>'decided')::boolean OR (v_state->>'restorable')::boolean THEN
        RAISE EXCEPTION 'a restored pairing must no longer offer a restore, got %', v_state;
    END IF;

    RAISE NOTICE 'lt_decision_reasons_test: ALL PASS';
END;
$$;

ROLLBACK;
