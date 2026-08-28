-- ============================================================================
-- Scheduling funnel, slice 2 — the pairing room waits for both gate answers
-- ============================================================================
-- Today a pairing room and its organizer card appear the moment the pairing
-- becomes real: at bracket publish for round 1 and the pools, and inside
-- lt_notify_tournament_match_ready for later rounds. Nobody has declared
-- anything at that point, so the card opens on a menu of times neither player
-- has committed to, and the room fills with the chat the arbitration is not
-- allowed to read. That is the shape Série 2 is reproducing: 19 of 42 pool
-- pairings have two players who talked and still produced no game.
--
-- The funnel inverts it (scheduling-funnel.md § 11, decision 1: strict lock):
-- the room opens only once BOTH sides have answered the gate, at which point
-- the card can be built from two real availability grids instead of guesses.
--
-- ---------------------------------------------------------------------------
-- Why this ships behind a flag
-- ---------------------------------------------------------------------------
-- Série 2 is live and paid, its pools close in days, and the gate has no UI
-- yet. Gating room creation unconditionally would mean its knockout pairings
-- get no room and no card at all, because no player can answer a gate that
-- has not been built. tournaments.scheduling_funnel_enabled therefore defaults
-- to FALSE and every behaviour below is conditional on it: running events keep
-- exactly today's behaviour, and the funnel is switched on per tournament once
-- the gate screen exists.
--
-- The ready PUSH is deliberately left firing at determinacy even when the
-- funnel is on (§ 9): a player must still learn their pairing exists. What
-- changes is where it sends them, which is the gate rather than a room.
--
-- Both hook bodies below are copied from their LATEST definitions
-- (20260809160100 for both) with one guard added each; nothing else in them
-- moves.
-- ============================================================================

ALTER TABLE public.tournaments
    ADD COLUMN IF NOT EXISTS scheduling_funnel_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tournaments.scheduling_funnel_enabled IS
'When true, pairing rooms and organizer cards wait for both sides to answer the
availability gate instead of appearing at publish / determinacy. Default false:
events that started before the gate existed keep the old behaviour.';

-- ---------------------------------------------------------------------------
-- Has this pairing's phase been answered by everyone who plays it?
-- ---------------------------------------------------------------------------
-- Strict on purpose: every user on both sides, not one per side. The options
-- engine needs each player's grid to compute an overlap that is true for all
-- of them, and a doubles pair where only the captain answered would produce a
-- card promising times the partner never offered.
--
-- Any outcome counts as an answer, 'forfeited' included: the gate answer is
-- the acknowledgement, and what a forfeit means for the result is the
-- resolution ladder's business, not the room's.
CREATE OR REPLACE FUNCTION public.lt_pairing_gate_ready(p_tm_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH tm AS (
        SELECT * FROM tournament_matches WHERE id = p_tm_id
    ), participants AS (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid
          FROM tm JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
    )
    SELECT EXISTS (SELECT 1 FROM participants)
       AND NOT EXISTS (
            SELECT 1 FROM participants p
             WHERE NOT EXISTS (
                SELECT 1
                  FROM tournament_phase_availability a, tm
                 WHERE a.tournament_id = tm.tournament_id
                   AND a.bracket_side  = tm.bracket_side
                   AND a.round_number  = CASE WHEN tm.bracket_side = 'pool' THEN 0
                                              ELSE tm.round_number END
                   AND a.player_id     = p.uid
             )
       );
$$;

COMMENT ON FUNCTION public.lt_pairing_gate_ready(uuid) IS
'True when every player on both sides of the pairing has a phase availability
row for the pairing''s own phase. The condition for opening the pairing room
under the scheduling funnel.';

-- ---------------------------------------------------------------------------
-- Opening the room the moment the second side answers
-- ---------------------------------------------------------------------------
-- A trigger rather than a call at the end of the gate RPC: any path that
-- records a gate answer should open what that answer unlocks, and the RPC
-- should not have to remember to.
CREATE OR REPLACE FUNCTION public.lt_open_pairings_on_gate_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled boolean;
    v_tm_id   uuid;
BEGIN
    SELECT t.scheduling_funnel_enabled INTO v_enabled
      FROM tournaments t WHERE t.id = NEW.tournament_id;
    IF NOT COALESCE(v_enabled, false) THEN
        RETURN NEW;
    END IF;

    FOR v_tm_id IN
        SELECT tm.id
          FROM tournament_matches tm
          JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
         WHERE tm.tournament_id = NEW.tournament_id
           AND tm.bracket_side  = NEW.bracket_side
           AND CASE WHEN tm.bracket_side = 'pool' THEN 0 ELSE tm.round_number END
               = NEW.round_number
           AND tm.status = 'pending'
           AND tm.match_id IS NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND (r.user_id = NEW.player_id OR r.partner_user_id = NEW.player_id)
           AND public.lt_pairing_gate_ready(tm.id)
    LOOP
        -- Never let card posting break the gate answer itself: the record is
        -- the evidence, the card is a convenience.
        BEGIN
            PERFORM public.lt_post_system_match_organizer_card(v_tm_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'gate-open card post failed for tournament_match %: %', v_tm_id, SQLERRM;
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_phase_availability_open_pairings
    ON public.tournament_phase_availability;

CREATE TRIGGER tournament_phase_availability_open_pairings
    AFTER INSERT OR UPDATE ON public.tournament_phase_availability
    FOR EACH ROW
    EXECUTE FUNCTION public.lt_open_pairings_on_gate_answer();

-- ---------------------------------------------------------------------------
-- Hook 1: rounds 2+ (copied from 20260809160100, one guard added)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_notify_tournament_match_ready(p_tm_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm     tournament_matches;
    v_t      tournaments;
    v_p1     text;
    v_p2     text;
    v_rows   jsonb;
BEGIN
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tm_id;
    -- Only when both sides are real, determinate players.
    IF v_tm.id IS NULL
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL
       OR v_tm.player1_is_bye
       OR v_tm.player2_is_bye THEN
        RETURN;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;
    v_p1 := public.lt_registration_display_name(v_tm.player1_registration_id);
    v_p2 := public.lt_registration_display_name(v_tm.player2_registration_id);

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', mb.uid,
        'type', 'tournament_match_ready',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(mb.uid)
                   THEN 'Ton prochain match est prêt' ELSE 'Your next match is set' END,
        'body', CASE WHEN public.lt_user_is_fr(mb.uid)
                  THEN v_t.name || ' : tour ' || v_tm.round_number || ' contre ' || mb.opp_name || '.'
                  ELSE v_t.name || ': round ' || v_tm.round_number || ' vs ' || mb.opp_name || '.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'round', v_tm.round_number,
            'tournamentMatchId', v_tm.id
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM (
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p2 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player1_registration_id
        UNION ALL
        SELECT unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS uid, v_p1 AS opp_name
        FROM tournament_registrations r WHERE r.id = v_tm.player2_registration_id
    ) mb;

    -- The push always fires: a player must learn their pairing exists whether
    -- or not the room is open yet. Under the funnel its CTA is the gate.
    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    -- Auto-post the organizer card for the fresh pairing. Never let card
    -- posting break bracket advancement.
    -- Under the funnel the card waits for both gate answers; the trigger on
    -- tournament_phase_availability posts it then.
    IF NOT COALESCE(v_t.scheduling_funnel_enabled, false)
       OR public.lt_pairing_gate_ready(p_tm_id) THEN
        BEGIN
            PERFORM public.lt_post_system_match_organizer_card(p_tm_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'organizer card auto-post failed for tournament_match %: %', p_tm_id, SQLERRM;
        END;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Hook 2: round 1 / pools at bracket publish (copied, one guard added)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_tournaments_post_organizer_cards_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tm_id uuid;
BEGIN
    -- Under the funnel nothing is posted at publish: players meet the gate
    -- first, and the room opens when both have answered.
    IF COALESCE(NEW.scheduling_funnel_enabled, false) THEN
        RETURN NEW;
    END IF;

    FOR v_tm_id IN
        SELECT tm.id
          FROM tournament_matches tm
         WHERE tm.tournament_id = NEW.id
           AND tm.status = 'pending'
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND tm.match_id IS NULL
    LOOP
        BEGIN
            PERFORM public.lt_post_system_match_organizer_card(v_tm_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'organizer card auto-post failed for tournament_match %: %', v_tm_id, SQLERRM;
        END;
    END LOOP;
    RETURN NEW;
END;
$$;
