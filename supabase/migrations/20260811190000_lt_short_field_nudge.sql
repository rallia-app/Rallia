-- ============================================================================
-- The short-field gate nudge, plus a fresh prompt after reopening.
--
-- 20260811180100 stayed silent when a tournament closed registration below the
-- draw floor. That left the under-floor case as the ONLY gate stall with no
-- notification at all: 5 entrants on a pool draw meant the organizer heard
-- nothing right up to the play date. It now says how many entered, how many the
-- draw needs, and the two moves that work today.
--
-- Those two moves are worth naming precisely, because the third one the spec
-- offers is not available. §11 lets the organizer postpone, cancel, or CONVERT
-- to single elimination. Postpone works (start_date and end_date are editable
-- at registration_closed, and tournament_reopen_registration accepts any
-- tournament whose start_date is still ahead, pushing registration_closes_at
-- out to it). Cancel works. Conversion does not: bracket_type and
-- max_participants are both draft-only, and the legal field sizes differ
-- between the structures (8/12/16/20/24/32 against 4/8/16/32/64/128), so a 12 or
-- 20-player pool event has no legal single-elim size to convert into. The copy
-- therefore points at reopening and postponing, not at conversion.
--
-- tournament_reopen_registration also clears draw_nudged_at now. A reopened
-- tournament is starting a fresh registration cycle, and without the reset the
-- next close would sit out the 48h cadence left over from the previous one
-- before telling the organizer they can draw.
--
-- Body from 20260622120200, extracted programmatically with one added line so
-- the rest stays byte-identical.
-- ============================================================================

-- ============================================
-- lt_nudge_tournament_gates — gate 1 now also speaks when the field is SHORT.
--
-- The first version stayed silent below the draw floor, on the reasoning that
-- pointing an organizer at a button which raises INSUFFICIENT_PARTICIPANTS is
-- worse than saying nothing. True, but it left the under-floor case as the only
-- gate stall with no notification at all: 5 entrants on a pool draw meant the
-- organizer heard nothing, ever, right up to the play date.
--
-- So it now says the useful thing instead of nothing: how many entered, how many
-- the draw needs, and the two moves that actually work today (reopen
-- registration, or push the dates back). Converting to single elimination is the
-- move the spec also offers (§11) and it is not buildable yet, since both
-- bracket_type and max_participants are draft-only and the legal field sizes
-- differ between the two structures.
--
-- Copy is assembled into locals before the aggregate rather than nested inside
-- it: language is per recipient, so eight bodies inline would be unreadable.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_nudge_tournament_gates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec      record;
    v_rows     jsonb;
    v_sent     integer := 0;
    v_pool     boolean;
    v_needed   integer;
    v_short    boolean;
    v_gate     text;
    v_title_fr text;
    v_title_en text;
    v_body_fr  text;
    v_body_en  text;
BEGIN
    -- ---------------------------------------------------------------
    -- Gate 1: registration is closed and nothing has been drawn.
    -- ---------------------------------------------------------------
    FOR v_rec IN
        SELECT t.id, t.name, t.organizer_id,
               (t.bracket_type = 'pool_knockout') AS is_pool,
               (SELECT count(*) FROM tournament_registrations r
                 WHERE r.tournament_id = t.id AND r.status = 'registered') AS entered
          FROM tournaments t
         WHERE t.status = 'registration_closed'
           AND now() < t.end_date + interval '14 days'
           AND (t.draw_nudged_at IS NULL
                OR t.draw_nudged_at < now() - interval '48 hours')
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m WHERE m.tournament_id = t.id)
    LOOP
        v_pool   := v_rec.is_pool;
        v_needed := CASE WHEN v_pool THEN 6 ELSE 2 END;
        v_short  := v_rec.entered < v_needed;

        IF v_short THEN
            v_gate     := 'short_field';
            v_title_fr := 'Trop peu d''inscrits';
            v_title_en := 'Not enough entries';
            v_body_fr  := v_rec.name || ' : ' || v_rec.entered
                || CASE WHEN v_rec.entered = 1 THEN ' inscription' ELSE ' inscriptions' END
                || ', il en faut ' || v_needed
                || CASE WHEN v_pool THEN ' pour former des poules.' ELSE ' pour un tableau.' END
                || ' Rouvre les inscriptions ou repousse les dates.';
            v_body_en := v_rec.name || ': ' || v_rec.entered
                || CASE WHEN v_rec.entered = 1 THEN ' entry' ELSE ' entries' END
                || ', ' || CASE WHEN v_pool THEN 'pools need ' ELSE 'a bracket needs ' END
                || v_needed || '. Reopen registration or push the dates back.';
        ELSE
            v_gate     := CASE WHEN v_pool THEN 'pools' ELSE 'bracket' END;
            v_title_fr := CASE WHEN v_pool THEN 'Poules à lancer' ELSE 'Tableau à tirer' END;
            v_title_en := CASE WHEN v_pool THEN 'Pools ready to start' ELSE 'Bracket ready to draw' END;
            v_body_fr  := v_rec.name || ' : inscriptions fermées (' || v_rec.entered || ').'
                || CASE WHEN v_pool
                     THEN ' Ajuste les têtes de série si tu veux, puis lance les poules.'
                     ELSE ' Tu peux tirer le tableau.' END;
            v_body_en  := v_rec.name || ': registration closed (' || v_rec.entered || ' in).'
                || CASE WHEN v_pool
                     THEN ' Adjust the seeds if you want, then start the pools.'
                     ELSE ' You can draw the bracket now.' END;
        END IF;

        SELECT jsonb_agg(jsonb_build_object(
            'user_id', u.uid,
            'type', 'tournament_action_required',
            'target_id', v_rec.id,
            'title', CASE WHEN public.lt_user_is_fr(u.uid) THEN v_title_fr ELSE v_title_en END,
            'body',  CASE WHEN public.lt_user_is_fr(u.uid) THEN v_body_fr  ELSE v_body_en  END,
            'payload', jsonb_build_object(
                'tournamentId', v_rec.id,
                'tournamentName', v_rec.name,
                'gate', v_gate,
                'entered', v_rec.entered,
                'needed', v_needed
            ),
            'priority', 'high'
        ))
          INTO v_rows
          FROM (
            SELECT v_rec.organizer_id AS uid
            UNION
            SELECT c.user_id FROM tournament_co_organizers c WHERE c.tournament_id = v_rec.id
          ) u
         WHERE u.uid IS NOT NULL;

        IF v_rows IS NOT NULL THEN
            PERFORM insert_notifications(v_rows);
            -- Deliberately not touching version: the organizer may have this
            -- tournament open, and bumping it would hand them an
            -- OPTIMISTIC_LOCK_CONFLICT the moment they act on the nudge.
            UPDATE tournaments SET draw_nudged_at = now() WHERE id = v_rec.id;
            v_sent := v_sent + 1;
        END IF;
    END LOOP;

    -- ---------------------------------------------------------------
    -- Gate 2: every pool game settled, knockout not launched.
    -- ---------------------------------------------------------------
    FOR v_rec IN
        SELECT t.id, t.name, t.organizer_id
          FROM tournaments t
         WHERE t.status = 'in_progress'
           AND t.bracket_type = 'pool_knockout'
           AND now() < t.end_date + interval '14 days'
           AND (t.knockout_nudged_at IS NULL
                OR t.knockout_nudged_at < now() - interval '48 hours')
           AND EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'pool')
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'main')
           -- Same terminal set tournament_generate_knockout gates on, so this
           -- stays quiet while a pool game is still disputed.
           AND NOT EXISTS (
                 SELECT 1 FROM tournament_matches m
                  WHERE m.tournament_id = t.id AND m.bracket_side = 'pool'
                    AND m.status NOT IN ('completed', 'retired', 'walkover', 'cancelled'))
    LOOP
        SELECT jsonb_agg(jsonb_build_object(
            'user_id', u.uid,
            'type', 'tournament_action_required',
            'target_id', v_rec.id,
            'title', CASE WHEN public.lt_user_is_fr(u.uid)
                       THEN 'Éliminatoires à lancer' ELSE 'Knockout ready to launch' END,
            'body', CASE WHEN public.lt_user_is_fr(u.uid)
                      THEN v_rec.name || ' : toutes les parties de poules sont réglées. '
                           || 'Lance la phase éliminatoire pour démarrer le tableau.'
                      ELSE v_rec.name || ': every pool game is settled. '
                           || 'Launch the knockout to start the bracket.'
                    END,
            'payload', jsonb_build_object(
                'tournamentId', v_rec.id,
                'tournamentName', v_rec.name,
                'gate', 'knockout'
            ),
            'priority', 'high'
        ))
          INTO v_rows
          FROM (
            SELECT v_rec.organizer_id AS uid
            UNION
            SELECT c.user_id FROM tournament_co_organizers c WHERE c.tournament_id = v_rec.id
          ) u
         WHERE u.uid IS NOT NULL;

        IF v_rows IS NOT NULL THEN
            PERFORM insert_notifications(v_rows);
            UPDATE tournaments SET knockout_nudged_at = now() WHERE id = v_rec.id;
            v_sent := v_sent + 1;
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

-- ============================================
-- tournament_reopen_registration — reset the gate-nudge stamp.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_reopen_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE tournaments
       SET status     = 'registration_open',
           registration_closes_at = CASE
               WHEN registration_closes_at IS NOT NULL AND registration_closes_at <= now()
               THEN start_date
               ELSE registration_closes_at
           END,
           -- A fresh registration cycle deserves a fresh prompt: without this
           -- the gate nudge would sit out its 48h cadence from the previous
           -- close before telling the organizer they can draw.
           draw_nudged_at = NULL,
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'registration_closed'
       AND bracket_locked_at IS NULL
       AND start_date > now()
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        -- Version, status, bracket, or start-date gate failed; report which.
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND bracket_locked_at IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BRACKET_ALREADY_GENERATED';
        END IF;
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND status = 'registration_closed' AND start_date <= now()) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_START_PASSED';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_CLOSED';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'reopen_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$$;