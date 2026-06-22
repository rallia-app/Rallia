-- ============================================
-- Leagues & Tournaments — reopen registration
-- ============================================
-- Lets an organizer reopen a closed registration window for late entrants, as
-- long as the bracket hasn't been generated yet. `registration_closed` is the
-- only state from which the bracket is generated (→ in_progress), so this is
-- the full "before the bracket is published" window the co-founder asked for.
--
-- Mirrors tournament_open_registration (20260612090100): requires a future
-- start_date and pushes a stale closes_at out to start_date, so the 15-min
-- auto-close cron (lt_close_due_tournament_registrations) doesn't immediately
-- re-close a freshly reopened window.
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

GRANT EXECUTE ON FUNCTION public.tournament_reopen_registration(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.tournament_reopen_registration(uuid, integer)
    IS 'Organizer reopens a closed registration window (→ registration_open) while the bracket is not yet generated. Clamps a stale closes_at to start_date. Spec: specs/17-leagues-tournaments/tournaments.md §Lifecycle.';
