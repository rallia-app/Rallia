-- ============================================================================
-- Leagues — the last score of a session froze every score in it
-- ============================================================================
-- session_record_score refuses unless the session is 'published' or
-- 'in_progress' (SESSION_NOT_ACTIVE). But the same function completes the
-- session as soon as no playable match remains. So the final score of a session
-- locks the whole session, not just that match: a typo anywhere in the sheet
-- becomes permanent the moment the last result lands, and the season ranking
-- keeps whatever it computed.
--
-- This is the league twin of the tournament-final defect fixed in
-- 20260729120000, reported the same way from staging ("Impossible de reviser
-- les scores car la seance est terminee"), and it gets the same shape of fix:
-- a grace window measured from completed_at.
--
--   * scoring stays open while the session is 'completed', for
--     LT_SESSION_CORRECTION_WINDOW after completed_at
--   * past it, the new CORRECTION_WINDOW_CLOSED distinguishes "too late" from
--     "wrong state"; cancelled/draft still get SESSION_NOT_ACTIVE
--
-- completed_at cannot drift: the completion UPDATE is guarded by
-- `status <> 'completed'`, so it stamps once and a correction never re-stamps
-- it. The window therefore runs from the original completion and repeated
-- corrections cannot extend it, matching the tournament behaviour.
--
-- recalc_season_ranking already runs on every call, including corrections, so
-- standings follow a corrected result with no extra work here.
--
-- Body is the live definition (20260628200000 as amended by the 2026-07-30
-- hardening batch) with only the status gate changed.
-- ============================================================================

-- Defaults reproduced exactly as the live function declares them. Omitting them
-- makes CREATE OR REPLACE fail ("cannot remove parameter defaults"), and
-- dropping to recreate would leave a window where PostgREST resolves nothing,
-- or worse, a second overload if the defaults were then restated differently.
CREATE OR REPLACE FUNCTION public.session_record_score(
    p_session_match_id uuid,
    p_winner_team      pairing_team,
    p_score            text DEFAULT NULL::text,
    p_status           session_match_status DEFAULT 'completed'::session_match_status,
    p_version_was      integer DEFAULT NULL::integer
)
RETURNS session_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- How long after a session completes an organizer can still fix a score.
    c_window   constant interval := interval '24 hours';

    v_caller   uuid := auth.uid();
    v_match    session_matches;
    v_session  sessions;
    v_season   seasons;
    v_row      session_matches;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_match FROM session_matches WHERE id = p_session_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = v_match.session_id;
    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    -- Organizer/admin override only. Participants score via the match bridge.
    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Active session, or a finished one still inside its correction window.
    IF v_session.status IN ('published', 'in_progress') THEN
        NULL;
    ELSIF v_session.status = 'completed' THEN
        -- A NULL completed_at means a row finished before the column was
        -- stamped; treat it as closed rather than guessing an anchor.
        IF v_session.completed_at IS NULL OR now() >= v_session.completed_at + c_window THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CORRECTION_WINDOW_CLOSED';
        END IF;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
    END IF;

    IF p_status NOT IN ('completed', 'retired', 'walkover') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;
    IF p_winner_team IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_REQUIRED';
    END IF;

    UPDATE session_matches
       SET score = p_score, winner_team = p_winner_team, status = p_status,
           played_at = now(), version = version + 1, updated_at = now()
     WHERE id = p_session_match_id AND version = p_version_was
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM session_matches WHERE id = p_session_match_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_FOUND';
    END IF;

    INSERT INTO session_match_scores (
        session_match_id, submitted_by, score, outcome_team, status, validated_by, validated_at
    )
    VALUES (
        p_session_match_id, v_caller, COALESCE(p_score, ''), p_winner_team, 'validated', v_caller, now()
    );

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session_match', v_row.id, 'override_score', v_caller,
        jsonb_build_object(
            'winner_team', p_winner_team,
            'status', p_status,
            'score', p_score,
            'post_completion', (v_session.status = 'completed')
        )
    );

    -- Session completes once no playable matches remain. The `status <>
    -- 'completed'` guard is what keeps completed_at stable across corrections.
    IF NOT EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_session.id AND status IN ('pending', 'in_progress')
    ) AND EXISTS (
        SELECT 1 FROM session_matches
         WHERE session_id = v_session.id AND status <> 'cancelled'
    ) THEN
        UPDATE sessions
           SET status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_session.id AND status <> 'completed';
    END IF;

    PERFORM public.recalc_season_ranking(v_session.season_id);

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.session_record_score(uuid, pairing_team, text, session_match_status, integer) IS
    'Organizer/admin score entry for a session match. Stays open for 24h after the session completes so the result that closed it can still be corrected (CORRECTION_WINDOW_CLOSED past that); recalculates the season ranking on every call.';
