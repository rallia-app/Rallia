-- ============================================
-- Scheduling funnel — declaring a forfeit, and nudging a silent opponent
-- ============================================
-- Covers 20260829230000.
--
--   lt_funnel_declare_forfeit
--     * a non-participant            -> NOT_A_PARTICIPANT
--     * a participant                -> walkover to the OTHER side, carrying
--                                       the format's forfeit score, oriented
--                                       player1-first
--     * the declaring side           -> takes the FORFEIT event
--                                       (match_cancelled_late), never the
--                                       unresponsive one: saying so is the
--                                       honest act and must not cost what
--                                       silence costs
--     * a linked game                -> cancelled, and the pairing released
--                                       before the walkover is written
--     * a settled pairing            -> MATCH_ALREADY_SETTLED
--
--   lt_funnel_ping_opponent
--     * everyone has answered        -> NOBODY_TO_PING
--     * a silent opponent            -> notified once, audited as initiative
--     * again inside 48 h            -> PING_TOO_SOON
--     * off the funnel               -> FUNNEL_NOT_ENABLED
--
-- Run against a fresh local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_funnel_forfeit_and_ping_test.sql
--
-- One transaction, ROLLBACK at the end.
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void;
$$;

DO $$
DECLARE
    v_tm       tournament_matches;
    v_ping_tm  tournament_matches;
    v_t        tournaments;
    v_players  uuid[];
    v_mine     uuid;
    v_outsider uuid;
    v_row      tournament_matches;
    v_round    smallint;
    v_before   int;
    v_after    int;
    v_n        int;
    v_err      text;
    v_match    uuid;
BEGIN
    -- Two distinct pool pairings on one in-progress event: one to concede,
    -- one to ping (conceding settles the row, so they cannot be the same).
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournaments t ON t.id = tm.tournament_id
     WHERE tm.bracket_side = 'pool' AND tm.status = 'pending'
       AND t.status = 'in_progress'
       AND tm.player1_registration_id IS NOT NULL AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     ORDER BY tm.id LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'fixture: no pending pool pairing on a live event';
    END IF;
    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_round := 0;

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);

    SELECT p.id INTO v_outsider FROM player p WHERE NOT (p.id = ANY (v_players)) LIMIT 1;

    -- A game stands on the pairing, so the cancel-then-walkover order matters.
    INSERT INTO match (sport_id, created_by, match_date, start_time, end_time)
    VALUES (v_t.sport_id, v_players[1], (now() + interval '1 day')::date, '18:00', '19:30')
    RETURNING id INTO v_match;
    UPDATE tournament_matches SET match_id = v_match WHERE id = v_tm.id;

    -- 1. A stranger cannot concede someone else's pairing.
    PERFORM pg_temp.as_user(v_outsider);
    BEGIN
        PERFORM public.lt_funnel_declare_forfeit(v_tm.id);
        RAISE EXCEPTION 'a non-participant should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'NOT_A_PARTICIPANT' THEN RAISE EXCEPTION 'expected NOT_A_PARTICIPANT, got %', v_err; END IF;
    END;

    -- 2. The declaring side concedes; the other takes the walkover.
    SELECT r.id INTO v_mine
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_players[1] OR r.partner_user_id = v_players[1]) LIMIT 1;

    SELECT count(*) INTO v_before FROM reputation_event
     WHERE player_id = v_players[1] AND event_type = 'match_cancelled_late';

    PERFORM pg_temp.as_user(v_players[1]);
    v_row := public.lt_funnel_declare_forfeit(v_tm.id);

    IF v_row.status <> 'walkover' THEN
        RAISE EXCEPTION 'expected a walkover, got %', v_row.status;
    END IF;
    IF v_row.winner_registration_id = v_mine THEN
        RAISE EXCEPTION 'the conceding side must not win its own forfeit';
    END IF;
    IF v_row.score IS DISTINCT FROM public.lt_forfeit_score(
           v_t.match_format, v_t.games_per_set, v_t.points_per_game,
           v_row.winner_registration_id = v_row.player1_registration_id) THEN
        RAISE EXCEPTION 'the walkover does not carry the format forfeit score: %', v_row.score;
    END IF;

    -- 3. The agreed game is cancelled and the pairing released, not left stale.
    IF v_row.match_id IS NOT NULL THEN
        RAISE EXCEPTION 'the pairing still points at the cancelled game';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM match WHERE id = v_match AND cancelled_at IS NOT NULL) THEN
        RAISE EXCEPTION 'the agreed game was not cancelled';
    END IF;

    -- 4. The forfeit event, and NOT the unresponsive one. This is the whole
    --    difference between conceding and going silent.
    SELECT count(*) INTO v_after FROM reputation_event
     WHERE player_id = v_players[1] AND event_type = 'match_cancelled_late';
    IF v_after <> v_before + 1 THEN
        RAISE EXCEPTION 'the conceding side did not take the forfeit event';
    END IF;
    IF EXISTS (
        SELECT 1 FROM reputation_event
         WHERE player_id = v_players[1] AND event_type = 'tournament_unresponsive'
           AND (metadata ->> 'tournamentMatchId')::uuid = v_tm.id
    ) THEN
        RAISE EXCEPTION 'conceding must never cost what silence costs';
    END IF;

    -- 5. It only happens once.
    BEGIN
        PERFORM public.lt_funnel_declare_forfeit(v_tm.id);
        RAISE EXCEPTION 'a settled pairing should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'MATCH_ALREADY_SETTLED' THEN RAISE EXCEPTION 'expected MATCH_ALREADY_SETTLED, got %', v_err; END IF;
    END;

    -- ---------------------------------------------------------------- ping
    SELECT tm.* INTO v_ping_tm
      FROM tournament_matches tm
     WHERE tm.tournament_id = v_t.id AND tm.bracket_side = 'pool'
       AND tm.status = 'pending' AND tm.id <> v_tm.id
       AND tm.player1_registration_id IS NOT NULL AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
     ORDER BY tm.id LIMIT 1;
    IF v_ping_tm.id IS NULL THEN
        RAISE EXCEPTION 'fixture: no second pool pairing to ping on';
    END IF;

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_ping_tm.player1_registration_id, v_ping_tm.player2_registration_id);

    DELETE FROM tournament_phase_availability
     WHERE tournament_id = v_t.id AND bracket_side = 'pool' AND round_number = v_round;
    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;

    -- 6. Off the funnel there is no nudge to send.
    UPDATE tournaments SET scheduling_funnel_enabled = false WHERE id = v_t.id;
    PERFORM pg_temp.as_user(v_players[1]);
    BEGIN
        PERFORM public.lt_funnel_ping_opponent(v_ping_tm.id);
        RAISE EXCEPTION 'a ping off the funnel should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'FUNNEL_NOT_ENABLED' THEN RAISE EXCEPTION 'expected FUNNEL_NOT_ENABLED, got %', v_err; END IF;
    END;
    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;

    -- 7. A silent opponent is nudged, once.
    v_n := public.lt_funnel_ping_opponent(v_ping_tm.id);
    IF v_n < 1 THEN
        RAISE EXCEPTION 'expected at least one opponent nudged, got %', v_n;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM leagues_tournaments_audit
         WHERE entity_id = v_ping_tm.id AND action = 'funnel_pinged' AND actor_id = v_players[1]
    ) THEN
        RAISE EXCEPTION 'the nudge was not recorded as initiative';
    END IF;

    -- 8. A nudge is only worth anything while it is rare.
    BEGIN
        PERFORM public.lt_funnel_ping_opponent(v_ping_tm.id);
        RAISE EXCEPTION 'a second nudge inside 48 h should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'PING_TOO_SOON' THEN RAISE EXCEPTION 'expected PING_TOO_SOON, got %', v_err; END IF;
    END;

    -- 9. Once everyone has answered there is nobody to nudge: they are all
    --    reachable in the pairing room by then.
    DELETE FROM leagues_tournaments_audit
     WHERE entity_id = v_ping_tm.id AND action = 'funnel_pinged';
    INSERT INTO tournament_phase_availability
        (tournament_id, bracket_side, round_number, player_id, outcome, hours_in_window, grid_snapshot)
    SELECT v_t.id, 'pool', v_round, u, 'edited', 2,
           '[{"day":"monday","hour":18}]'::jsonb
      FROM unnest(v_players) u
    ON CONFLICT DO NOTHING;
    BEGIN
        PERFORM public.lt_funnel_ping_opponent(v_ping_tm.id);
        RAISE EXCEPTION 'a nudge with nobody silent should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'NOBODY_TO_PING' THEN RAISE EXCEPTION 'expected NOBODY_TO_PING, got %', v_err; END IF;
    END;

    RAISE NOTICE 'lt_funnel_forfeit_and_ping_test: ALL PASS';
END;
$$;

ROLLBACK;
