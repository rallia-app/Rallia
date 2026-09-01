-- ============================================================================
-- "Proposer un autre moment": the other side's one counter-offer.
-- ============================================================================
-- scheduling-funnel.md § 5.4, the half left out of 20260829190000 because its
-- counter had a real ambiguity. Settled here:
--
--   The counter is ONE PER SIDE PER PAIRING, not per booking. Per booking does
--   not terminate: A books, B re-proposes, A books again (a fresh booking, so
--   B's counter resets), B re-proposes, forever. Per pairing bounds the whole
--   exchange at two counters and matches Jean's rule literally, "chacun doit
--   avoir une chance de donner son avis" is one chance each, not a negotiation
--   without end.
--
--   The count is read from the audit rather than kept in a column, the same way
--   the resolver enforces its once-only grace and extension. The counter has to
--   outlive the booking it was spent on (re-proposing deletes that booking), so
--   a column on lt_pairing_booking would be the wrong home for it anyway.
--
-- The counter-slot is posted as a CUSTOM option, not booked. That looks like a
-- step backwards and is deliberate: silence counts as acceptance only because
-- the silent side declared that hour free (§ 8). A counter names an hour they
-- never offered, so it needs their explicit thumb. Two thumbs already book a
-- slot, so nothing new is required to finish the exchange.
--
-- The cancelled game is flagged mutually_cancelled. R3' already reads that as
-- "detach, back to the ladder with both sides deemed E", which is exactly a
-- penalty-free cancellation: the agreement was never firm, so forfeit-on-cancel
-- does not apply.
--
-- Also fixed here, a bug from 20260829190000: tentative_until was now() + 24 h
-- unconditionally, so a booking made three hours before the deadline stayed
-- "tentative" past it and lt_booking_is_firm would answer false at the very
-- moment the ladder asks. It is clamped to the effective deadline.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_funnel_book_mutual_option(
    p_message_id    uuid,
    p_option_index  int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_window constant interval := interval '24 hours';

    v_caller    uuid := auth.uid();
    v_meta      jsonb;
    v_tm        tournament_matches;
    v_t         tournaments;
    v_option    jsonb;
    v_players   uuid[];
    v_n         int;
    v_match_id  uuid;
    v_slot      timestamptz;
    v_rows      jsonb;
    v_caller_reg uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT m.metadata INTO v_meta
      FROM message m
     WHERE m.id = p_message_id AND m.message_type = 'match_organizer';
    IF v_meta IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARD_NOT_FOUND';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches
     WHERE id = (v_meta ->> 'tournament_match_id')::uuid
     FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PAIRING_CARD';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    -- One tap is a funnel rule: it rests on both sides having declared
    -- themselves free inside the phase. Off the funnel the card keeps thumbs.
    IF NOT COALESCE(v_t.scheduling_funnel_enabled, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FUNNEL_NOT_ENABLED';
    END IF;

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);
    v_n := COALESCE(array_length(v_players, 1), 0);

    IF NOT (v_caller = ANY (v_players)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    SELECT r.id INTO v_caller_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_caller OR r.partner_user_id = v_caller)
     LIMIT 1;

    IF v_tm.match_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_BOOKED';
    END IF;

    v_option := v_meta -> 'options' -> p_option_index;
    IF v_option IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTION_NOT_FOUND';
    END IF;

    -- The whole justification for skipping the vote: EVERY side is free here.
    -- A one-sided or custom option has to keep its two thumbs.
    IF COALESCE((v_option ->> 'free_count')::int, 0) < v_n THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTION_NOT_MUTUAL';
    END IF;

    v_slot := (v_option ->> 'slot_start')::timestamptz;

    -- Principle 7: nothing is bookable past the deadline that will judge it.
    IF v_slot >= COALESCE(public.lt_effective_match_deadline(v_tm), 'infinity'::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SLOT_PAST_DEADLINE';
    END IF;

    -- create_casual_match keys idempotency on the card's created_match_id and
    -- stamps it, so a double tap returns the same game rather than a second one.
    v_match_id := public.create_casual_match(
        p_sport_id        => v_t.sport_id,
        p_slot_start      => v_slot,
        p_player_ids      => v_players,
        p_format          => CASE WHEN v_t.entry_format = 'singles'
                                  THEN 'singles' ELSE 'doubles' END::match_format_enum,
        p_facility_id     => NULLIF(v_option ->> 'facility_id', '')::uuid,
        p_duration_minutes=> 60,
        p_source_message_id => p_message_id,
        p_option_index    => p_option_index,
        p_location_name   => v_option ->> 'facility_name'
    );

    PERFORM public.tournament_attach_match_pre_play(v_tm.id, v_match_id);

    -- The window may never outlive the clock that will judge the pairing: a
    -- booking made three hours before the deadline would otherwise still read
    -- as "not firm" at the moment R3' asks (principle 7 again).
    INSERT INTO lt_pairing_booking
        (tournament_match_id, match_id, booked_by, booked_at, tentative_until)
    VALUES (v_tm.id, v_match_id, v_caller, now(),
            LEAST(now() + c_window,
                  COALESCE(public.lt_effective_match_deadline(v_tm), now() + c_window)))
    ON CONFLICT (tournament_match_id) DO UPDATE
        SET match_id        = EXCLUDED.match_id,
            booked_by       = EXCLUDED.booked_by,
            booked_at       = EXCLUDED.booked_at,
            tentative_until = EXCLUDED.tentative_until,
            accepted_at     = NULL,
            accepted_by     = NULL;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', v_tm.id, 'funnel_booked', v_caller,
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'match_id', v_match_id,
                               'slot_start', v_slot,
                               'option_index', p_option_index));

    -- The other side has to be told: the 24 h window is their say, and it is
    -- already running.
    SELECT jsonb_agg(jsonb_build_object(
        'user_id',   u.uid,
        'type',      'tournament_match_ready',
        'target_id', v_tm.tournament_id,
        'title',     CASE WHEN public.lt_user_is_fr(u.uid)
                       THEN 'Partie proposee' ELSE 'Game proposed' END,
        'body',      CASE WHEN public.lt_user_is_fr(u.uid)
                       THEN v_t.name || ' : ' || COALESCE(public.lt_registration_display_name(v_caller_reg), 'Un joueur')
                            || ' a cree votre partie. Confirme, ou propose un autre moment.'
                       ELSE v_t.name || ': ' || COALESCE(public.lt_registration_display_name(v_caller_reg), 'A player')
                            || ' created your game. Confirm it, or propose another time.'
                     END,
        'payload',   jsonb_build_object('tournamentId', v_tm.tournament_id,
                                        'tournamentMatchId', v_tm.id,
                                        'matchId', v_match_id),
        'priority',  'high'
    )) INTO v_rows
    FROM (SELECT unnest(v_players) AS uid) u
    WHERE u.uid <> v_caller;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN v_match_id;
END;
$$;

-- --------------------------------------------- the counter-offer, once a side
CREATE OR REPLACE FUNCTION public.lt_funnel_repropose_slot(
    p_tournament_match_id uuid,
    p_slot_start          timestamptz,
    p_facility_id         uuid DEFAULT NULL,
    p_place_name          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_booking lt_pairing_booking;
    v_tm      tournament_matches;
    v_t       tournaments;
    v_players uuid[];
    v_msg     uuid;
    v_meta    jsonb;
    v_rows    jsonb;
    v_reg     uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_booking FROM lt_pairing_booking
     WHERE tournament_match_id = p_tournament_match_id FOR UPDATE;
    IF v_booking.tournament_match_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOKING_NOT_FOUND';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id FOR UPDATE;
    SELECT * INTO v_t  FROM tournaments WHERE id = v_tm.tournament_id;

    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);

    IF NOT (v_caller = ANY (v_players)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- The window is the OTHER side's say. The booker already chose; if they
    -- want a different hour they cancel the game like anyone else.
    IF v_caller = v_booking.booked_by THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOKER_CANNOT_REPROPOSE';
    END IF;

    -- Accepted, or the window has run out: the agreement is firm and a counter
    -- would now be a cancellation, with everything that carries.
    IF v_booking.accepted_at IS NOT NULL OR now() >= v_booking.tentative_until THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINDOW_CLOSED';
    END IF;

    -- One per side per PAIRING. The audit is the durable record, and it has to
    -- be, because the booking this counter is spent on is about to be deleted.
    IF EXISTS (
        SELECT 1 FROM leagues_tournaments_audit a
         WHERE a.scope = 'tournament_match'
           AND a.entity_id = p_tournament_match_id
           AND a.action = 'funnel_reproposed'
           AND a.actor_id = v_caller
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REPROPOSAL_SPENT';
    END IF;

    IF p_slot_start >= COALESCE(public.lt_effective_match_deadline(v_tm), 'infinity'::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SLOT_PAST_DEADLINE';
    END IF;

    -- The card, which is about to go back to offering options.
    SELECT m.id, m.metadata INTO v_msg, v_meta
      FROM message m
     WHERE m.message_type = 'match_organizer'
       AND (m.metadata ->> 'tournament_match_id')::uuid = p_tournament_match_id
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1;
    IF v_msg IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARD_NOT_FOUND';
    END IF;

    -- Penalty-free: the agreement was never firm. mutually_cancelled is what
    -- R3' reads as "neither side is at fault"; the detach trigger releases the
    -- pairing on its own.
    UPDATE match
       SET cancelled_at       = now(),
           mutually_cancelled = true,
           updated_at         = now()
     WHERE id = v_booking.match_id AND cancelled_at IS NULL;

    DELETE FROM lt_pairing_booking WHERE tournament_match_id = p_tournament_match_id;

    -- The card is settled only while a game stands; reopening it is what lets
    -- the counter be added and thumbed.
    UPDATE message
       SET metadata = metadata || jsonb_build_object(
                        'created_match_id', NULL,
                        'confirmed_option_index', NULL)
     WHERE id = v_msg;

    PERFORM public.match_organizer_add_custom_option(
        v_msg, p_slot_start, p_facility_id, p_place_name);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', p_tournament_match_id, 'funnel_reproposed', v_caller,
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'cancelled_match_id', v_booking.match_id,
                               'slot_start', p_slot_start));

    SELECT r.id INTO v_reg
      FROM tournament_registrations r
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
       AND (r.user_id = v_caller OR r.partner_user_id = v_caller)
     LIMIT 1;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id',   v_booking.booked_by,
        'type',      'tournament_match_ready',
        'target_id', v_tm.tournament_id,
        'title',     CASE WHEN public.lt_user_is_fr(v_booking.booked_by)
                       THEN 'Autre moment propose' ELSE 'Another time proposed' END,
        'body',      CASE WHEN public.lt_user_is_fr(v_booking.booked_by)
                       THEN v_t.name || ' : ' || COALESCE(public.lt_registration_display_name(v_reg), 'Ton adversaire')
                            || ' propose un autre moment. Regarde la proposition.'
                       ELSE v_t.name || ': ' || COALESCE(public.lt_registration_display_name(v_reg), 'Your opponent')
                            || ' proposed another time. Take a look.'
                     END,
        'payload',   jsonb_build_object('tournamentId', v_tm.tournament_id,
                                        'tournamentMatchId', v_tm.id),
        'priority',  'high'
    )) INTO v_rows;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN v_msg;
END;
$$;

COMMENT ON FUNCTION public.lt_funnel_repropose_slot(uuid, timestamptz, uuid, text) IS
'"Proposer un autre moment": the side that did not book cancels the tentative
game without penalty and posts a counter-slot as a custom option on the card,
which the booker then thumbs to book. ONE per side per pairing, counted from
the audit (REPROPOSAL_SPENT), and only while the window is open (WINDOW_CLOSED).
Spec: scheduling-funnel.md § 5.4.';

REVOKE ALL ON FUNCTION public.lt_funnel_repropose_slot(uuid, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_funnel_repropose_slot(uuid, timestamptz, uuid, text) TO authenticated;
