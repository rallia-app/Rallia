-- ============================================================================
-- Tournaments — archiving is no longer a one-way door
-- ============================================================================
-- tournament_archive moves a completed or cancelled tournament to 'archived',
-- and listMyTournaments filters that status out, so an organizer who archived
-- one had no screen that showed it and no RPC that brought it back. Reported as
-- "une fois archive je ne le vois plus nulle part et je ne peux pas le
-- remettre".
--
-- tournament_unarchive is the inverse: organizer or admin, archived only, back
-- to where it came from. The destination is derived from the row itself
-- (cancelled_at set means it was cancelled, otherwise it completed) rather than
-- guessed, so a cancelled tournament never reappears as a completed one.
--
-- tournament_archive now also records the status it left behind in its audit
-- payload. Nothing reads it yet — the derivation above is authoritative and
-- works for the rows archived before today — but it makes the trail answer the
-- question directly instead of by inference.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_unarchive(
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
    v_before    tournaments;
    v_target    tournament_status;
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_before FROM tournaments WHERE id = p_tournament_id;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_before.status <> 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_ARCHIVED';
    END IF;

    -- Where it came from. archive only accepts completed / cancelled, so these
    -- are the only two destinations.
    v_target := CASE WHEN v_before.cancelled_at IS NOT NULL
                     THEN 'cancelled'::tournament_status
                     ELSE 'completed'::tournament_status END;

    UPDATE tournaments
       SET status      = v_target,
           archived_at = NULL,
           version     = version + 1,
           updated_at  = now()
     WHERE id = p_tournament_id
       AND version = p_version_was
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('tournament', v_row.id, 'unarchive', v_caller_id,
            jsonb_build_object('restored_to', v_target));

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.tournament_unarchive(uuid, integer) IS
'Restores an archived tournament to the status it was archived from, derived
from cancelled_at (cancelled) or otherwise completed. Organizer or admin only.';

REVOKE ALL ON FUNCTION public.tournament_unarchive(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.tournament_unarchive(uuid, integer) TO authenticated;


-- ------------------------------------------------- archive records its origin
CREATE OR REPLACE FUNCTION public.tournament_archive(
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
    v_from      tournament_status;
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Money still in flight: a succeeded payment that has been neither refunded
    -- (cancel path) nor paid out (completion path). Archiving now would drop the
    -- tournament out of lt_cancel_refund_candidates / lt_release_candidates,
    -- which both match on the exact pre-archive status.
    IF EXISTS (
        SELECT 1
          FROM lt_registration_payment p
          JOIN tournament_registrations r ON r.id = p.tournament_registration_id
         WHERE r.tournament_id = p_tournament_id
           AND p.status = 'succeeded'
           AND p.stripe_payout_id IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SETTLEMENT_PENDING';
    END IF;

    SELECT status INTO v_from FROM tournaments WHERE id = p_tournament_id;

    UPDATE tournaments
       SET status       = 'archived',
           archived_at  = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id = p_tournament_id
       AND version = p_version_was
       AND status IN ('completed', 'cancelled')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_ARCHIVABLE';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'archive', v_caller_id,
        jsonb_build_object('archived_from', v_from)
    );

    RETURN v_row;
END;
$$;
