-- ============================================
-- Scheduling funnel — one tap books a mutual slot, tentative for 24 h
-- ============================================
-- Covers 20260829190000. The card is built by hand here: the point under test
-- is the booking rule, not the options engine, which has its own test.
--
--   lt_funnel_book_mutual_option
--     * a non-participant              -> NOT_A_PARTICIPANT
--     * an event off the funnel        -> FUNNEL_NOT_ENABLED (thumbs still rule)
--     * a one-sided option             -> OPTION_NOT_MUTUAL
--     * a slot past the deadline       -> SLOT_PAST_DEADLINE (principle 7)
--     * a mutual option                -> game created, linked, tentative 24 h
--     * a second tap                   -> ALREADY_BOOKED
--
--   lt_funnel_accept_booking
--     * the booker                     -> BOOKER_CANNOT_ACCEPT
--     * the other side                 -> accepted, and firm immediately
--     * twice                          -> idempotent
--
--   lt_booking_is_firm
--     * inside the window, unaccepted  -> false
--     * accepted                       -> true
--
-- Run against a fresh local stack:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_funnel_one_tap_booking_test.sql
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
    v_t        tournaments;
    v_players  uuid[];
    v_n        int;
    v_conv     uuid;
    v_msg      uuid;
    v_outsider uuid;
    v_slot     timestamptz;
    v_deadline timestamptz;
    v_match    uuid;
    v_booking  lt_pairing_booking;
    v_err      text;
BEGIN
    -- A real pool pairing whose phase has a deadline ahead of us.
    SELECT tm.* INTO v_tm
      FROM tournament_matches tm
      JOIN tournaments t   ON t.id = tm.tournament_id
      JOIN tournament_round_deadlines d
        ON d.tournament_id = tm.tournament_id AND d.bracket_side = 'pool'
     WHERE tm.bracket_side = 'pool'
       AND tm.status = 'pending'
       AND tm.match_id IS NULL
       AND tm.player1_registration_id IS NOT NULL
       AND tm.player2_registration_id IS NOT NULL
       AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
       AND d.deadline_at > now() + interval '3 days'
     ORDER BY tm.id LIMIT 1;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION 'fixture: no pool pairing with a future deadline';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_deadline := public.lt_effective_match_deadline(v_tm);
    v_slot     := date_trunc('hour', now() + interval '2 days');

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);
    v_n := array_length(v_players, 1);

    SELECT p.id INTO v_outsider FROM player p
     WHERE NOT (p.id = ANY (v_players)) LIMIT 1;

    -- A card to tap. Two options: index 0 mutual, index 1 one-sided.
    SELECT c.id INTO v_conv FROM conversation c LIMIT 1;
    INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
    VALUES (v_conv, v_players[1], 'card', 'sent', 'match_organizer',
            jsonb_build_object(
              'kind', 'match_organizer',
              'tournament_match_id', v_tm.id,
              'sport_id', v_t.sport_id,
              'participant_ids', to_jsonb(v_players),
              'posted_by', 'system',
              'created_match_id', NULL,
              'confirmed_option_index', NULL,
              'options', jsonb_build_array(
                 jsonb_build_object('slot_start', v_slot, 'free_count', v_n,
                                    'facility_id', NULL, 'facility_name', 'Parc Test'),
                 jsonb_build_object('slot_start', v_slot + interval '1 day', 'free_count', 1,
                                    'facility_id', NULL, 'facility_name', 'Parc Test'),
                 jsonb_build_object('slot_start', v_deadline + interval '1 day', 'free_count', v_n,
                                    'facility_id', NULL, 'facility_name', 'Parc Test'))))
    RETURNING id INTO v_msg;

    -- 1. Off the funnel the one tap does not exist: the card keeps its thumbs.
    UPDATE tournaments SET scheduling_funnel_enabled = false WHERE id = v_t.id;
    PERFORM pg_temp.as_user(v_players[1]);
    BEGIN
        PERFORM public.lt_funnel_book_mutual_option(v_msg, 0);
        RAISE EXCEPTION 'booking off the funnel should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'FUNNEL_NOT_ENABLED' THEN RAISE EXCEPTION 'expected FUNNEL_NOT_ENABLED, got %', v_err; END IF;
    END;
    UPDATE tournaments SET scheduling_funnel_enabled = true WHERE id = v_t.id;

    -- 2. A stranger cannot book someone else's pairing.
    PERFORM pg_temp.as_user(v_outsider);
    BEGIN
        PERFORM public.lt_funnel_book_mutual_option(v_msg, 0);
        RAISE EXCEPTION 'a non-participant should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'NOT_A_PARTICIPANT' THEN RAISE EXCEPTION 'expected NOT_A_PARTICIPANT, got %', v_err; END IF;
    END;

    -- 3. A one-sided option keeps the two-thumb rule.
    PERFORM pg_temp.as_user(v_players[1]);
    BEGIN
        PERFORM public.lt_funnel_book_mutual_option(v_msg, 1);
        RAISE EXCEPTION 'a one-sided option should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'OPTION_NOT_MUTUAL' THEN RAISE EXCEPTION 'expected OPTION_NOT_MUTUAL, got %', v_err; END IF;
    END;

    -- 4. Nothing is bookable past the deadline that will judge it.
    BEGIN
        PERFORM public.lt_funnel_book_mutual_option(v_msg, 2);
        RAISE EXCEPTION 'a slot past the deadline should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'SLOT_PAST_DEADLINE' THEN RAISE EXCEPTION 'expected SLOT_PAST_DEADLINE, got %', v_err; END IF;
    END;

    -- 5. The mutual option books in one tap.
    v_match := public.lt_funnel_book_mutual_option(v_msg, 0);
    IF v_match IS NULL THEN RAISE EXCEPTION 'booking returned no game'; END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    IF v_tm.match_id IS DISTINCT FROM v_match THEN
        RAISE EXCEPTION 'the game was not linked to the pairing';
    END IF;

    SELECT * INTO v_booking FROM lt_pairing_booking WHERE tournament_match_id = v_tm.id;
    IF v_booking.match_id IS DISTINCT FROM v_match THEN
        RAISE EXCEPTION 'no booking row for the pairing';
    END IF;
    IF v_booking.booked_by <> v_players[1] THEN
        RAISE EXCEPTION 'booking credited to the wrong side';
    END IF;
    IF v_booking.tentative_until <= now() THEN
        RAISE EXCEPTION 'the tentative window is not open';
    END IF;
    IF v_booking.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'a fresh booking must not be pre-accepted';
    END IF;

    -- 6. Tentative is not yet an agreement.
    IF public.lt_booking_is_firm(v_tm.id) THEN
        RAISE EXCEPTION 'a booking inside its window is not firm';
    END IF;

    -- 7. The pairing already has its game.
    BEGIN
        PERFORM public.lt_funnel_book_mutual_option(v_msg, 0);
        RAISE EXCEPTION 'a second booking should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'ALREADY_BOOKED' THEN RAISE EXCEPTION 'expected ALREADY_BOOKED, got %', v_err; END IF;
    END;

    -- 8. The booker cannot supply the other side's agreement.
    BEGIN
        PERFORM public.lt_funnel_accept_booking(v_tm.id);
        RAISE EXCEPTION 'the booker should not be able to accept';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'BOOKER_CANNOT_ACCEPT' THEN RAISE EXCEPTION 'expected BOOKER_CANNOT_ACCEPT, got %', v_err; END IF;
    END;

    -- 9. The other side says "ca marche": firm at once, and explicitly.
    PERFORM pg_temp.as_user(v_players[2]);
    v_booking := public.lt_funnel_accept_booking(v_tm.id);
    IF v_booking.accepted_at IS NULL OR v_booking.accepted_by <> v_players[2] THEN
        RAISE EXCEPTION 'acceptance was not recorded';
    END IF;
    IF NOT public.lt_booking_is_firm(v_tm.id) THEN
        RAISE EXCEPTION 'an accepted booking must be firm';
    END IF;

    -- 10. Saying it twice is the same answer, not an error.
    v_booking := public.lt_funnel_accept_booking(v_tm.id);
    IF v_booking.accepted_by <> v_players[2] THEN
        RAISE EXCEPTION 'a repeated acceptance changed the record';
    END IF;

    RAISE NOTICE 'lt_funnel_one_tap_booking_test: ALL PASS';
END;
$$;

ROLLBACK;
