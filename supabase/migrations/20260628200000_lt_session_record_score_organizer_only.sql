-- ============================================================================
-- Leagues — V9 bridge slice 3: session_record_score becomes organizer override
-- ============================================================================
-- With the session match bridge (20260628190000), players settle their pairing
-- by linking a verified casual match (session_attach_match) so scoring reuses the
-- canonical confirmation + feedback + rating flow. session_record_score is now
-- the organizer/admin AUTHORITATIVE OVERRIDE path only — it no longer accepts a
-- participant submitting their own result (that path moved to the match bridge).
--
-- Only change vs 20260618140000: the auth check drops the `v_is_participant`
-- branch (participant self-scoring) and now requires organizer/admin. Everything
-- else (validation, write, session completion, recalc) is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_record_score(
    p_session_match_id uuid,
    p_winner_team      pairing_team,
    p_score            text                  DEFAULT NULL,
    p_status           session_match_status  DEFAULT 'completed',
    p_version_was      integer               DEFAULT NULL
)
RETURNS session_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

    IF v_session.status NOT IN ('published', 'in_progress') THEN
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
        jsonb_build_object('winner_team', p_winner_team, 'status', p_status, 'score', p_score)
    );

    -- Session completes once no playable matches remain.
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

GRANT EXECUTE ON FUNCTION public.session_record_score(uuid, pairing_team, text, session_match_status, integer)
    TO authenticated;
