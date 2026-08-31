-- ============================================================================
-- One tap books a mutual slot, and the booking is tentative for 24 h.
-- ============================================================================
-- scheduling-funnel.md 5.3 and 5.4. Two rules, and the second is Jean's
-- non-finality surviving in a shape the machine can read:
--
--   5.3 A MUTUAL slot needs no vote. Both sides declared themselves free for
--       it inside the phase, so the card offers one CTA, "Creer la partie",
--       that either side may tap. Custom and one-sided options keep the
--       two-thumb rule, because only one side's hours back them.
--   5.4 A fresh booking is TENTATIVE for 24 h. The other side is told and can
--       accept; accepting, or saying nothing for 24 h, turns it into an
--       agreement, and forfeit-on-cancel applies from then on.
--
-- Why the state is a row and not an inference: the ladder has to tell an
-- explicit "ca marche" from silence. R3 records a no-show against a side that
-- accepted and then did not appear, but only unresponsive against one that
-- never answered (scheduling-funnel.md 8). Nothing already stored can carry
-- that difference, so lt_pairing_booking carries it, one row per pairing.
--
-- Deliberately reusing tournament_match_ready for the notice: the moment for
-- the receiving player is "your pairing has a time now", which is what that
-- type already means, and it is wired through every client mapping, icon,
-- label and preference toggle. A new enum value would be dark on every client
-- until each of those is taught about it (the lesson of 20260811200000).
--
-- Not in this migration, and deliberately: "proposer un autre moment" inside
-- the window. It cancels the tentative game and posts a counter-slot, which
-- needs the cancel path and a per-side counter; it ships with the card UI so
-- the counter's semantics are settled against a real screen rather than
-- guessed at here.
-- ============================================================================

-- ------------------------------------------------------------- the record
CREATE TABLE IF NOT EXISTS public.lt_pairing_booking (
    tournament_match_id uuid PRIMARY KEY
        REFERENCES public.tournament_matches(id) ON DELETE CASCADE,
    match_id            uuid NOT NULL REFERENCES public.match(id) ON DELETE CASCADE,
    booked_by           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    booked_at           timestamptz NOT NULL DEFAULT now(),
    tentative_until     timestamptz NOT NULL,
    accepted_at         timestamptz,
    accepted_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT lt_pairing_booking_accept_pair
        CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);

COMMENT ON TABLE public.lt_pairing_booking IS
'The scheduling funnel''s tentative booking, one row per pairing. Written by
lt_funnel_book_mutual_option and stamped by lt_funnel_accept_booking. The
distinction the resolution ladder needs is accepted_at IS NOT NULL (an explicit
"ca marche", which makes a later absence a no-show) versus silence past
tentative_until (an agreement all the same, but absence reads as unresponsive).
Spec: scheduling-funnel.md 5.4 and 8.';

CREATE INDEX IF NOT EXISTS lt_pairing_booking_match_idx
    ON public.lt_pairing_booking (match_id);

ALTER TABLE public.lt_pairing_booking ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can see the pairing's tournament; writes go through
-- the RPCs only, so there is no INSERT/UPDATE/DELETE policy at all.
DROP POLICY IF EXISTS lt_pairing_booking_select ON public.lt_pairing_booking;
CREATE POLICY lt_pairing_booking_select ON public.lt_pairing_booking
    FOR SELECT USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1
              FROM public.tournament_matches tm
              JOIN public.tournaments t ON t.id = tm.tournament_id
             WHERE tm.id = lt_pairing_booking.tournament_match_id
               AND (t.visibility = 'public'
                    OR public.is_tournament_organizer(t.id)
                    OR public.is_tournament_registrant(t.id))
        )
    );

-- The default Data API grants end 2026-10-30, so a new public table that
-- relied on them would go dark.
GRANT SELECT ON public.lt_pairing_booking TO authenticated;
REVOKE ALL ON public.lt_pairing_booking FROM anon;

-- --------------------------------------------------- is the agreement firm?
-- One place the ladder can ask, so R3' never re-derives the window.
CREATE OR REPLACE FUNCTION public.lt_booking_is_firm(p_tournament_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM lt_pairing_booking b
         WHERE b.tournament_match_id = p_tournament_match_id
           AND (b.accepted_at IS NOT NULL OR now() >= b.tentative_until)
    );
$$;

COMMENT ON FUNCTION public.lt_booking_is_firm(uuid) IS
'True once a tentative booking has become an agreement: the other side said
"ca marche", or the 24 h window ran out on silence. Forfeit-on-cancel applies
from that moment (unplayed-match-resolution.md R3'').';

REVOKE ALL ON FUNCTION public.lt_booking_is_firm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_booking_is_firm(uuid) TO authenticated;

-- ------------------------------------------------------------- the one tap
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

    INSERT INTO lt_pairing_booking
        (tournament_match_id, match_id, booked_by, booked_at, tentative_until)
    VALUES (v_tm.id, v_match_id, v_caller, now(), now() + c_window)
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

COMMENT ON FUNCTION public.lt_funnel_book_mutual_option(uuid, int) IS
'One-tap booking of a MUTUAL option on a funnel pairing card: creates the game,
links it to the pairing, and opens a 24 h tentative window the other side is
notified about. Refuses a non-mutual option (OPTION_NOT_MUTUAL, those keep the
two-thumb rule), an event off the funnel (FUNNEL_NOT_ENABLED), a pairing that
already has a game (ALREADY_BOOKED) and a slot past the deadline that would
judge it (SLOT_PAST_DEADLINE). Spec: scheduling-funnel.md 5.3.';

REVOKE ALL ON FUNCTION public.lt_funnel_book_mutual_option(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_funnel_book_mutual_option(uuid, int) TO authenticated;

-- ------------------------------------------------------------- "ca marche"
CREATE OR REPLACE FUNCTION public.lt_funnel_accept_booking(p_tournament_match_id uuid)
RETURNS public.lt_pairing_booking
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_booking lt_pairing_booking;
    v_tm      tournament_matches;
    v_players uuid[];
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_booking FROM lt_pairing_booking
     WHERE tournament_match_id = p_tournament_match_id FOR UPDATE;
    IF v_booking.tournament_match_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOKING_NOT_FOUND';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id;
    SELECT array_agg(DISTINCT u.uid) INTO v_players
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u(uid)
     WHERE r.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id);

    IF NOT (v_caller = ANY (v_players)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_A_PARTICIPANT';
    END IF;

    -- The booker already said yes by booking. Letting them "accept" would fake
    -- the other side's agreement, which is the one thing this record is for.
    IF v_caller = v_booking.booked_by THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BOOKER_CANNOT_ACCEPT';
    END IF;

    -- Idempotent: a second tap is not an error, it is the same answer.
    IF v_booking.accepted_at IS NOT NULL THEN
        RETURN v_booking;
    END IF;

    UPDATE lt_pairing_booking
       SET accepted_at = now(), accepted_by = v_caller
     WHERE tournament_match_id = p_tournament_match_id
    RETURNING * INTO v_booking;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament_match', p_tournament_match_id, 'funnel_booking_accepted', v_caller,
            jsonb_build_object('tournament_id', v_tm.tournament_id,
                               'match_id', v_booking.match_id));

    RETURN v_booking;
END;
$$;

COMMENT ON FUNCTION public.lt_funnel_accept_booking(uuid) IS
'"Ca marche": the side that did not book accepts the tentative game, which
makes the agreement firm immediately instead of at the end of the 24 h window,
and records an EXPLICIT acceptance, so a later absence is a no-show rather than
unresponsiveness. Idempotent. Spec: scheduling-funnel.md 5.4.';

REVOKE ALL ON FUNCTION public.lt_funnel_accept_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lt_funnel_accept_booking(uuid) TO authenticated;
