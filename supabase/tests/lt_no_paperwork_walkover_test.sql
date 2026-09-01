-- ============================================
-- Tournaments — nobody is eliminated on paperwork alone
-- ============================================
-- Timeliness and volume are earned by filling in a grid; only reactivity
-- reflects dealing with the opponent. When neither side has any reactivity and
-- nothing was ever booked, the gap rule must not separate them, or the app
-- eliminates the worse form-filler on a pairing where nobody tried to play.
--
--   m1  knockout, both engaged, no attempt  → NOT decided, escalated once
--   m2  knockout, both engaged, one reacted → gap rule still applies
--   pool, both engaged, no attempt          → cancelled, reason 'no_attempt'
--   lt_user_acted                           → per person, not per registration
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_no_paperwork_walkover_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void; $$;
CREATE OR REPLACE FUNCTION pg_temp.players(n int) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(player_id) FROM (
    SELECT ps.player_id FROM player_sport ps JOIN sport s ON s.id = ps.sport_id
     WHERE s.name = 'tennis' AND ps.is_active AND NOT public.is_admin(ps.player_id)
     ORDER BY ps.player_id LIMIT n) t; $$;
CREATE OR REPLACE FUNCTION pg_temp.staff_on(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO admin (id, role) VALUES (p, 'support') ON CONFLICT (id) DO NOTHING; $$;
CREATE OR REPLACE FUNCTION pg_temp.staff_off(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM admin WHERE id = p; $$;

CREATE OR REPLACE FUNCTION pg_temp.gate(
    p_t uuid, p_side text, p_round int, p_reg uuid, p_late boolean, p_hours int)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, p_side, p_round, u, 'edited',
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = p_side)
         + CASE WHEN p_late THEN interval '5 days' ELSE interval '1 hour' END,
         p_hours, '[{"day":"monday","hour":18}]'::jsonb
    FROM unnest(public.lt_registration_users(p_reg)) u
  ON CONFLICT (tournament_id, bracket_side, round_number, player_id) DO UPDATE
    SET hours_in_window = EXCLUDED.hours_in_window, responded_at = EXCLUDED.responded_at; $$;

DO $$
DECLARE
    v_p uuid[]; v_org uuid; v_t tournaments; v_ver int;
    v_m1 tournament_matches; v_m2 tournament_matches; v_row tournament_matches;
    v_min int; v_cnt int; v_user uuid;
BEGIN
    -- ============================================ knockout of 4
    v_p := pg_temp.players(5); v_org := v_p[5];
    PERFORM pg_temp.as_user(v_org); PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM public.tournament_create('[TEST-NP] Knockout',
        (SELECT id FROM sport WHERE name = 'tennis'), 4::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_p[i]); PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;
    UPDATE tournament_matches SET deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE tournament_id = v_t.id AND round_number = 1;
    SELECT COALESCE(min_availability_hours, 6) INTO v_min FROM tournaments WHERE id = v_t.id;

    SELECT * INTO v_m1 FROM tournament_matches
     WHERE tournament_id = v_t.id AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_m2 FROM tournament_matches
     WHERE tournament_id = v_t.id AND round_number = 1 AND match_position = 2;

    -- m1: prompt+generous vs late+thin, and NOBODY proposes anything.
    PERFORM pg_temp.gate(v_t.id, 'main', 1, v_m1.player1_registration_id, false, v_min);
    PERFORM pg_temp.gate(v_t.id, 'main', 1, v_m1.player2_registration_id, true, 1);
    -- m2: same shape, except the stronger side actually reached out.
    PERFORM pg_temp.gate(v_t.id, 'main', 1, v_m2.player1_registration_id, false, v_min);
    PERFORM pg_temp.gate(v_t.id, 'main', 1, v_m2.player2_registration_id, true, 1);
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament_match', v_m2.id, 'funnel_pinged',
           (public.lt_registration_users(v_m2.player1_registration_id))[1], '{}'::jsonb;

    PERFORM public.lt_resolve_due_tournament_matches(false);

    -- m1 must NOT be decided: form quality alone is not a reason to eliminate.
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m1.id;
    IF v_row.status <> 'pending' OR v_row.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'a knockout with no attempt must not be decided, got % / %',
                        v_row.status, v_row.winner_registration_id;
    END IF;
    SELECT count(*) INTO v_cnt FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_m1.id AND action = 'auto_escalated';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'expected exactly one escalation, got %', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM notification
     WHERE user_id = v_org AND (payload ->> 'tournamentMatchId')::uuid = v_m1.id;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'the organizer must be told, got % notifications', v_cnt;
    END IF;

    -- Running again must not escalate twice, or every pass spams the organizer.
    PERFORM public.lt_resolve_due_tournament_matches(false);
    SELECT count(*) INTO v_cnt FROM leagues_tournaments_audit
     WHERE scope = 'tournament_match' AND entity_id = v_m1.id AND action = 'auto_escalated';
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'escalation must be idempotent, got % rows', v_cnt;
    END IF;

    -- m2 keeps the gap rule: someone did reach out, so the signals may decide.
    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m2.id;
    IF v_row.status <> 'walkover' OR v_row.winner_registration_id IS DISTINCT FROM v_m2.player1_registration_id THEN
        RAISE EXCEPTION 'the gap rule must still apply when a side reached out, got % / %',
                        v_row.status, v_row.winner_registration_id;
    END IF;

    -- ============================================ the same in a pool
    v_p := pg_temp.players(9); v_org := v_p[9];
    PERFORM pg_temp.as_user(v_org); PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM public.tournament_create('[TEST-NP] Pool',
        (SELECT id FROM sport WHERE name = 'tennis'), 8::smallint,
        now() + interval '1 day', now() + interval '20 days',
        p_bracket_type => 'pool_knockout'::bracket_type,
        p_pool_size => 4::smallint, p_qualifiers_per_pool => 2::smallint);
    PERFORM pg_temp.staff_off(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.as_user(v_p[i]); PERFORM public.tournament_register(v_t.id, NULL);
    END LOOP;
    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_pools(v_t.id, v_ver);

    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    UPDATE tournament_round_deadlines SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = 0;
    UPDATE tournament_matches SET deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    SELECT COALESCE(min_availability_hours, 6) INTO v_min FROM tournaments WHERE id = v_t.id;

    SELECT * INTO v_m1 FROM tournament_matches
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' LIMIT 1;
    PERFORM pg_temp.gate(v_t.id, 'pool', 0, v_m1.player1_registration_id, false, v_min);
    PERFORM pg_temp.gate(v_t.id, 'pool', 0, v_m1.player2_registration_id, true, 1);

    PERFORM public.lt_resolve_due_tournament_matches(false);

    SELECT * INTO v_row FROM tournament_matches WHERE id = v_m1.id;
    IF v_row.status <> 'cancelled' THEN
        RAISE EXCEPTION 'a pool game nobody attempted must be cancelled, got %', v_row.status;
    END IF;
    SELECT count(*) INTO v_cnt FROM notification
     WHERE (payload ->> 'tournamentMatchId')::uuid = v_m1.id
       AND payload ->> 'rule' = 'no_attempt';
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'both sides should be told why, got % notifications', v_cnt;
    END IF;

    -- ============================================ acted is per person
    v_user := (public.lt_registration_users(v_m1.player1_registration_id))[1];
    IF NOT public.lt_user_acted(v_m1.id, v_user) THEN
        RAISE EXCEPTION 'a player who answered the gate must count as having acted';
    END IF;
    SELECT id INTO v_user FROM auth.users
     WHERE id <> ALL (public.lt_registration_users(v_m1.player1_registration_id)
                      || public.lt_registration_users(v_m1.player2_registration_id))
     LIMIT 1;
    IF public.lt_user_acted(v_m1.id, v_user) THEN
        RAISE EXCEPTION 'a stranger to the pairing must not count as having acted';
    END IF;

    RAISE NOTICE 'lt_no_paperwork_walkover_test: ALL PASS';
END;
$$;

ROLLBACK;
