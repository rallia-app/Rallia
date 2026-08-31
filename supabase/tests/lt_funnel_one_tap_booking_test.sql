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
--     * the window never outlives the phase deadline
--
--   lt_funnel_repropose_slot
--     * the booker                     -> BOOKER_CANNOT_REPROPOSE
--     * the other side                 -> game cancelled (mutually, no fault),
--                                         pairing released, card reopened with
--                                         the counter as a custom option
--     * a second counter by that side  -> REPROPOSAL_SPENT (one per PAIRING)
--     * once the window has closed     -> WINDOW_CLOSED
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
    v_meta     jsonb;
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

    -- The card must live in the pairing's REAL round chat: create_casual_match
    -- reads that conversation's tournament_match_id and attaches the game
    -- itself, which is the path production takes. Posting into any old
    -- conversation hides that and lets a double-attach through.
    PERFORM pg_temp.as_user(v_players[1]);
    SELECT public.get_or_create_tournament_round_chat(v_tm.id) INTO v_conv;
    -- One system card per pairing is enforced; this test supplies its own.
    DELETE FROM message WHERE conversation_id = v_conv AND message_type = 'match_organizer';
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

    -- 11. The window never outlives the clock that judges the pairing.
    DELETE FROM lt_pairing_booking WHERE tournament_match_id = v_tm.id;
    UPDATE tournament_matches SET match_id = NULL WHERE id = v_tm.id;
    UPDATE message SET metadata = metadata || jsonb_build_object(
             'created_match_id', NULL, 'confirmed_option_index', NULL)
     WHERE id = v_msg;
    -- A slot inside a deliberately short window, so the clamp is what bites.
    UPDATE message
       SET metadata = jsonb_set(metadata, '{options}',
             (metadata -> 'options') || jsonb_build_array(jsonb_build_object(
                'slot_start', date_trunc('hour', now() + interval '1 hour'),
                'free_count', v_n, 'facility_id', NULL, 'facility_name', 'Parc Test')))
     WHERE id = v_msg;
    UPDATE tournament_round_deadlines SET deadline_at = now() + interval '3 hours'
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    PERFORM pg_temp.as_user(v_players[1]);
    v_match := public.lt_funnel_book_mutual_option(v_msg, 3);
    SELECT * INTO v_booking FROM lt_pairing_booking WHERE tournament_match_id = v_tm.id;
    IF v_booking.tentative_until > now() + interval '3 hours' + interval '1 minute' THEN
        RAISE EXCEPTION 'the tentative window outlived the deadline: %', v_booking.tentative_until;
    END IF;

    -- 12. The booker does not get to counter their own booking.
    BEGIN
        PERFORM public.lt_funnel_repropose_slot(v_tm.id, v_slot + interval '3 hours');
        RAISE EXCEPTION 'the booker should not be able to re-propose';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'BOOKER_CANNOT_REPROPOSE' THEN RAISE EXCEPTION 'expected BOOKER_CANNOT_REPROPOSE, got %', v_err; END IF;
    END;

    -- 13. The other side counters: penalty-free cancel, pairing released, card
    --     reopened with the counter offered as a custom option.
    UPDATE tournament_round_deadlines SET deadline_at = v_deadline
     WHERE tournament_id = v_t.id AND bracket_side = 'pool';
    PERFORM pg_temp.as_user(v_players[2]);
    PERFORM public.lt_funnel_repropose_slot(v_tm.id, v_slot + interval '3 hours');

    IF EXISTS (SELECT 1 FROM lt_pairing_booking WHERE tournament_match_id = v_tm.id) THEN
        RAISE EXCEPTION 'the counter did not clear the booking';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM match WHERE id = v_match
           AND cancelled_at IS NOT NULL AND mutually_cancelled
    ) THEN
        RAISE EXCEPTION 'the game was not cancelled without fault';
    END IF;
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    IF v_tm.match_id IS NOT NULL THEN
        RAISE EXCEPTION 'the pairing still points at the cancelled game';
    END IF;
    SELECT metadata INTO v_meta FROM message WHERE id = v_msg;
    IF COALESCE(v_meta ->> 'created_match_id', '') <> '' THEN
        RAISE EXCEPTION 'the card is still settled after a counter';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_meta -> 'options') o
         WHERE o ->> 'tier' = 'custom'
    ) THEN
        RAISE EXCEPTION 'the counter-slot was not offered on the card';
    END IF;

    -- 14. One per side per PAIRING: the counter is spent even though the
    --     booking it was spent on is gone. This is what terminates the
    --     exchange instead of letting the two sides trade slots forever.
    PERFORM pg_temp.as_user(v_players[1]);
    v_match := public.lt_funnel_book_mutual_option(v_msg, 0);
    PERFORM pg_temp.as_user(v_players[2]);
    BEGIN
        PERFORM public.lt_funnel_repropose_slot(v_tm.id, v_slot + interval '5 hours');
        RAISE EXCEPTION 'a second counter by the same side should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'REPROPOSAL_SPENT' THEN RAISE EXCEPTION 'expected REPROPOSAL_SPENT, got %', v_err; END IF;
    END;

    -- 15. Once the window is closed the counter is a cancellation, not a say.
    UPDATE lt_pairing_booking SET tentative_until = now() - interval '1 minute'
     WHERE tournament_match_id = v_tm.id;
    DELETE FROM leagues_tournaments_audit
     WHERE entity_id = v_tm.id AND action = 'funnel_reproposed';
    BEGIN
        PERFORM public.lt_funnel_repropose_slot(v_tm.id, v_slot + interval '6 hours');
        RAISE EXCEPTION 'a counter past the window should have been refused';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'WINDOW_CLOSED' THEN RAISE EXCEPTION 'expected WINDOW_CLOSED, got %', v_err; END IF;
    END;

    RAISE NOTICE 'lt_funnel_one_tap_booking_test: ALL PASS';
END;
$$;

ROLLBACK;
