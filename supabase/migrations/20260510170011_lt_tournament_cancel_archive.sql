-- ============================================
-- Leagues & Tournaments — V5: tournament_cancel + tournament_archive
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V5
--       specs/17-leagues-tournaments/tournaments.md §Cancellation
--
-- tournament_cancel:
--   - organizer-only
--   - any non-terminal state (draft / registration_open / registration_closed
--     / in_progress) → cancelled
--   - cancelled_at + cancelled_reason set
--   - all pending / in_progress matches flip to status='cancelled'
--   - bracket-locked status preserved (don't touch already-completed matches)
--
-- tournament_archive:
--   - organizer-only
--   - completed OR cancelled → archived
--   - archived_at set
--
-- The 30-day auto-archive cron is intentionally deferred — for V5 the
-- organizer triggers archive manually from the detail screen.
-- ============================================


-- =====================
-- tournament_cancel
-- =====================

CREATE OR REPLACE FUNCTION public.tournament_cancel(
    p_tournament_id uuid,
    p_reason        text,
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
    v_match_count integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    UPDATE tournaments
       SET status            = 'cancelled',
           cancelled_at      = now(),
           cancelled_reason  = p_reason,
           version           = version + 1,
           updated_at        = now()
     WHERE id = p_tournament_id
       AND version = p_version_was
       AND status IN ('draft', 'registration_open', 'registration_closed', 'in_progress')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_CANCELLABLE';
    END IF;

    -- Cascade: pending or in-progress matches → cancelled
    UPDATE tournament_matches
       SET status     = 'cancelled',
           version    = version + 1,
           updated_at = now()
     WHERE tournament_id = p_tournament_id
       AND status IN ('pending', 'in_progress');
    GET DIAGNOSTICS v_match_count = ROW_COUNT;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'cancel', v_caller_id,
        jsonb_build_object(
            'reason', p_reason,
            'matches_cancelled', v_match_count
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_cancel(uuid, text, integer) TO authenticated;


-- =====================
-- tournament_archive
-- =====================

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
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

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
        'tournament', v_row.id, 'archive', v_caller_id, '{}'::jsonb
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_archive(uuid, integer) TO authenticated;
