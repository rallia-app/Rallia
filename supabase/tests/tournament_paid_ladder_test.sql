-- ============================================
-- Tournaments — F4c: resolution ladder on PAID draws
-- ============================================
-- A paid single-elim draw of 4 with an expired round-1 deadline:
--   * semi 1: one side engaged at the gate → walkover; the passive loser PLAYED
--     nothing but a single walkover is not the refund case → stays
--     registered, no refund queued;
--   * semi 2: both silent → double walkover; the zero-games refund is
--     retired (Jean 2026-08-23, unplayed-match-resolution.md § 10), so both
--     sides STAY registered, no refund is queued, and once the event
--     completes both entries release to the organizer like any played entry.
--
-- Run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/tournament_paid_ladder_test.sql

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

CREATE OR REPLACE FUNCTION pg_temp.setup_payouts(p_org uuid)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
    VALUES (p_org, 'acct_test_' || left(p_org::text, 8), true)
    ON CONFLICT (player_id) DO UPDATE SET charges_enabled = true;
$$;

CREATE OR REPLACE FUNCTION pg_temp.mark_paid(p_reg uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_payment_intent_id = 'pi_' || left(p_reg::text, 8),
           stripe_charge_id = 'ch_' || left(p_reg::text, 8), updated_at = now()
     WHERE tournament_registration_id = p_reg AND status = 'pending';
    UPDATE tournament_registrations
       SET status = 'registered', version = version + 1, updated_at = now()
     WHERE id = p_reg;
$$;

-- The ladder reads gate answers now, not chat. These two helpers put a side
-- into the state the assertions below are about.
CREATE OR REPLACE FUNCTION pg_temp.engaged(p_t uuid, p_reg uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, 'main', 1, u, 'edited',
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = 'main'),
         12, '[{"day":"monday","hour":18}]'::jsonb
    FROM unnest(public.lt_registration_users(p_reg)) u
  ON CONFLICT (tournament_id, bracket_side, round_number, player_id) DO UPDATE
    SET hours_in_window = 12, outcome = 'edited', responded_at = EXCLUDED.responded_at;
$$;

CREATE OR REPLACE FUNCTION pg_temp.passive(p_t uuid, p_reg uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO tournament_phase_availability
      (tournament_id, bracket_side, round_number, player_id, outcome,
       responded_at, hours_in_window, grid_snapshot)
  SELECT p_t, 'main', 1, u, 'skipped',
         (SELECT min(created_at) FROM tournament_matches
           WHERE tournament_id = p_t AND bracket_side = 'main') + interval '5 days',
         0, '[]'::jsonb
    FROM unnest(public.lt_registration_users(p_reg)) u
  ON CONFLICT (tournament_id, bracket_side, round_number, player_id) DO UPDATE
    SET hours_in_window = 0, outcome = 'skipped', responded_at = EXCLUDED.responded_at;
$$;

CREATE OR REPLACE FUNCTION pg_temp.say(p_tm uuid, p_user uuid, p_text text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_conv uuid;
BEGIN
    PERFORM pg_temp.as_user(p_user);
    SELECT public.get_or_create_tournament_round_chat(p_tm) INTO v_conv;
    INSERT INTO message (conversation_id, sender_id, content) VALUES (v_conv, p_user, p_text);
END;
$$;

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

DO $$
DECLARE
    v_players uuid[];
    v_org     uuid;
    v_t       tournaments;
    v_ver     integer;
    v_m1      tournament_matches;
    v_m2      tournament_matches;
    v_res     record;
    v_reg     tournament_registrations;
    v_cnt     integer;
BEGIN
    v_players := pg_temp.tennis_players(9);
    v_org     := v_players[9];

    PERFORM pg_temp.as_user(v_org);
    PERFORM pg_temp.staff_on(v_org);
    SELECT * INTO v_t FROM public.tournament_create(
        '[TEST-DL] Paid ladder', (SELECT id FROM sport WHERE name = 'tennis'), 4::smallint,
        now() + interval '1 day', now() + interval '20 days');
    PERFORM pg_temp.staff_off(v_org);
    UPDATE tournaments
       SET entry_fee_cents = 1500, currency = 'CAD', fee_payer = 'player_pays',
           created_at = now() - interval '2 days'
     WHERE id = v_t.id;
    PERFORM pg_temp.setup_payouts(v_org);

    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_open_registration(v_t.id, v_ver);

    FOR i IN 1..4 LOOP
        PERFORM pg_temp.as_user(v_players[i]);
        SELECT * INTO v_res FROM public.tournament_begin_paid_registration(v_t.id, NULL);
        PERFORM pg_temp.mark_paid(v_res.registration_id);
    END LOOP;

    PERFORM pg_temp.as_user(v_org);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_close_registration(v_t.id, v_ver);
    SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
    PERFORM public.tournament_generate_bracket(v_t.id, v_ver);

    UPDATE tournament_round_deadlines
       SET deadline_at = now() - interval '1 hour'
     WHERE tournament_id = v_t.id AND bracket_side = 'main' AND round_number = 1;

    SELECT * INTO v_m1 FROM tournament_matches
     WHERE tournament_id = v_t.id AND round_number = 1 AND match_position = 1;
    SELECT * INTO v_m2 FROM tournament_matches
     WHERE tournament_id = v_t.id AND round_number = 1 AND match_position = 2;

    -- The ladder only acts on funnel events, and reads gate answers, so the
    -- effort split is expressed there rather than in chat.
    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;
    UPDATE tournament_matches
       SET deadline_nudge48_at = now() - interval '2 days',
           deadline_nudge12_at = now() - interval '12 hours'
     WHERE tournament_id = v_t.id AND round_number = 1;
    PERFORM pg_temp.engaged(v_t.id, v_m1.player1_registration_id);
    PERFORM pg_temp.passive(v_t.id, v_m1.player2_registration_id);

    PERFORM public.lt_resolve_due_tournament_matches(false);

    -- Semi 1: walkover for the effortful side; silent loser keeps their
    -- registration (single walkover is never the refund case).
    SELECT * INTO v_m1 FROM tournament_matches WHERE id = v_m1.id;
    IF v_m1.status <> 'walkover' OR v_m1.winner_registration_id <> v_m1.player1_registration_id THEN
        RAISE EXCEPTION 'paid semi 1 not walkover for effortful side';
    END IF;
    SELECT * INTO v_reg FROM tournament_registrations WHERE id = v_m1.player2_registration_id;
    IF v_reg.status <> 'registered' THEN
        RAISE EXCEPTION 'single-walkover loser should stay registered, got %', v_reg.status;
    END IF;

    -- Semi 2: double walkover; the zero-games refund is retired, so both
    -- sides keep their registration and nothing is queued.
    SELECT * INTO v_m2 FROM tournament_matches WHERE id = v_m2.id;
    IF v_m2.status <> 'walkover' OR v_m2.winner_registration_id IS NOT NULL THEN
        RAISE EXCEPTION 'paid semi 2 not a double walkover';
    END IF;
    SELECT count(*) INTO v_cnt FROM tournament_registrations
     WHERE id IN (v_m2.player1_registration_id, v_m2.player2_registration_id)
       AND status = 'registered';
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'expected both double-walkover sides to stay registered, got %', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM leagues_tournaments_audit
     WHERE scope = 'registration' AND action = 'auto_refund_queued'
       AND entity_id IN (v_m2.player1_registration_id, v_m2.player2_registration_id);
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'no refund may be queued post-open, got % audit rows', v_cnt;
    END IF;
    SELECT count(*) INTO v_cnt FROM public.lt_cancel_refund_candidates() c
      JOIN lt_registration_payment p ON p.id = c.payment_id
     WHERE p.tournament_registration_id
           IN (v_m2.player1_registration_id, v_m2.player2_registration_id);
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'expected 0 refund candidates, got %', v_cnt;
    END IF;

    -- And at completion the entries settle to the organizer like any played
    -- entry, so no payment sits 'succeeded' forever.
    UPDATE tournaments
       SET status = 'completed', start_date = now() - interval '3 days',
           end_date = now() - interval '2 days'
     WHERE id = v_t.id;
    SELECT count(*) INTO v_cnt FROM public.lt_release_candidates() c
      JOIN lt_registration_payment p ON p.id = c.payment_id
     WHERE p.tournament_registration_id
           IN (v_m2.player1_registration_id, v_m2.player2_registration_id);
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'expected both double-walkover entries releasable at completion, got %', v_cnt;
    END IF;

    RAISE NOTICE 'tournament_paid_ladder_test: ALL PASS';
END;
$$;

ROLLBACK;
