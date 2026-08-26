-- ============================================================================
-- The deadline is absolute: it cannot be moved once it has passed, and it
-- cannot be pulled in on short notice.
-- ============================================================================
-- Jean's review of the unplayed-match spec, 2026-08-23: "L'organisateur doit
-- avoir le pouvoir unilatéral de modifier les échéances même lorsque le
-- tournoi est en cours ... Mais une fois l'échéance atteinte, la logique de
-- decision doit être inviolable."
--
-- specs/17-leagues-tournaments/unplayed-match-resolution.md principle 7 and
-- § 9 turn that into two rules this RPC did not enforce:
--
--   1. Once a stored deadline has passed, it is frozen. The pairing is decided
--      (or about to be), and the way back is a restore or an organizer
--      override, never a rewritten clock. The previous body allowed a past
--      deadline to be rewritten as long as the round carried no unresolved
--      match, which is exactly the state a resolved round is in.
--   2. Pushing a deadline back is always allowed; pulling it in is refused
--      inside 48 h, so nobody loses a window they were already promised. The
--      floor mirrors the protocol window (ready / T-48 / T-12).
--
-- Deliberately unchanged: DEADLINE_IN_PAST still fires for a value in the past
-- on a round with unresolved matches, so its existing test and its client copy
-- keep their meaning. DEADLINE_TOO_SOON only ever applies to a future value.
--
-- One behaviour change beyond the guards: a row whose value is identical to
-- what is stored is now skipped outright, before any check. A caller that
-- posts its whole set can no longer be refused over a row it never touched,
-- and a resubmission no longer re-notifies a draw about deadlines that did not
-- move.
--
-- Body copied from 20260810230000_lt_round_deadlines_ddl.sql (the latest
-- migration defining it) with the guards and v_existing added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_set_round_deadlines(
    p_tournament_id uuid,
    p_rounds        jsonb
)
RETURNS SETOF tournament_round_deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_tournament tournaments;
    v_item       jsonb;
    v_side       text;
    v_round      smallint;
    v_at         timestamptz;
    v_existing   timestamptz;
    v_prev       timestamptz;
    v_sides      text[] := '{}';
    v_rounds     smallint[] := '{}';
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.status NOT IN ('registration_open', 'registration_closed', 'in_progress') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DEADLINES';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_rounds) LOOP
        v_side  := COALESCE(v_item->>'bracket_side', 'main');
        v_round := (v_item->>'round_number')::smallint;
        v_at    := (v_item->>'deadline_at')::timestamptz;
        IF v_side NOT IN ('main', 'pool') OR v_round IS NULL OR v_at IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DEADLINES';
        END IF;

        SELECT trd.deadline_at INTO v_existing
          FROM tournament_round_deadlines trd
         WHERE trd.tournament_id = p_tournament_id
           AND trd.bracket_side  = v_side
           AND trd.round_number  = v_round;

        -- An unchanged row is not an edit: no guard, no write, no
        -- notification. This has to come before every check, or a caller that
        -- posts its whole set is refused over a row it never touched, and it
        -- also stops a resubmission from re-notifying the whole draw.
        CONTINUE WHEN v_at IS NOT DISTINCT FROM v_existing;

        -- A deadline for a side/round with unresolved matches must be ahead
        -- of now; fully resolved rounds may carry historical values.
        IF v_at <= now() AND EXISTS (
            SELECT 1 FROM tournament_matches tm
             WHERE tm.tournament_id = p_tournament_id
               AND tm.bracket_side  = v_side
               AND (v_side = 'pool' OR tm.round_number = v_round)
               AND tm.status IN ('pending', 'in_progress', 'disputed')
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_IN_PAST';
        END IF;

        IF v_existing IS NOT NULL THEN
            -- Reached means settled: the clock is not the appeal court.
            IF v_existing <= now() THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_PASSED';
            END IF;
            -- Later is always fine. Earlier may not steal a promised window.
            IF v_at > now() AND v_at < v_existing AND v_at < now() + interval '48 hours' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINE_TOO_SOON';
            END IF;
        END IF;

        INSERT INTO tournament_round_deadlines AS trd
            (tournament_id, bracket_side, round_number, deadline_at)
        VALUES (p_tournament_id, v_side, v_round, v_at)
        ON CONFLICT (tournament_id, bracket_side, round_number)
        DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();

        v_sides  := v_sides  || v_side;
        v_rounds := v_rounds || v_round;
    END LOOP;

    -- Strictly increasing across main rounds.
    v_prev := NULL;
    FOR v_at IN
        SELECT deadline_at FROM tournament_round_deadlines
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
         ORDER BY round_number
    LOOP
        IF v_prev IS NOT NULL AND v_at <= v_prev THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DEADLINES_NOT_INCREASING';
        END IF;
        v_prev := v_at;
    END LOOP;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament', p_tournament_id, 'set_round_deadlines', v_caller_id, p_rounds);

    IF 'pool' = ANY (v_sides) THEN
        PERFORM public.lt_notify_tournament_deadline_changed(p_tournament_id, 'pool', '{0}'::smallint[]);
    END IF;
    IF 'main' = ANY (v_sides) THEN
        PERFORM public.lt_notify_tournament_deadline_changed(
            p_tournament_id, 'main',
            ARRAY(SELECT unnest(v_rounds) EXCEPT SELECT 0::smallint));
    END IF;

    RETURN QUERY
        SELECT * FROM tournament_round_deadlines
         WHERE tournament_id = p_tournament_id
         ORDER BY bracket_side, round_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_set_round_deadlines(uuid, jsonb) TO authenticated;
