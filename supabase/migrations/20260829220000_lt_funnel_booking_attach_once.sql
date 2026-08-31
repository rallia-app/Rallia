-- ============================================================================
-- The one tap must not double-attach the game it just created.
-- ============================================================================
-- lt_funnel_book_mutual_option created the game and then attached it, but
-- create_casual_match ALREADY attaches when the source card lives in a round
-- chat: it reads that conversation's tournament_match_id and calls
-- tournament_attach_match_pre_play itself. So the second call raised
-- ALREADY_LINKED, and it did so on exactly the real path.
--
-- The test missed it because it posts its card into an arbitrary conversation
-- to keep the options engine out of the way; that conversation carries no
-- tournament_match_id, so nothing auto-attached and the redundant call looked
-- fine. The test is corrected in the same commit to use the pairing's real
-- round chat, which is what found this.
--
-- Body re-issued from 20260829210000, verified byte-identical against the live
-- definition before editing.
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

    -- create_casual_match already attaches when the card lives in a round chat
    -- (it reads the conversation's tournament_match_id), so attaching again
    -- would raise ALREADY_LINKED on exactly the real path. Re-read and only
    -- attach when nothing did it for us.
    SELECT * INTO v_tm FROM tournament_matches WHERE id = v_tm.id;
    IF v_tm.match_id IS NULL THEN
        PERFORM public.tournament_attach_match_pre_play(v_tm.id, v_match_id);
    ELSIF v_tm.match_id <> v_match_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_BOOKED';
    END IF;

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
