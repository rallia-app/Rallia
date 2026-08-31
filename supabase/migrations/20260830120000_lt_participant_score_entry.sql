-- ============================================================================
-- L&T — participants can record their own result when no game was created
-- ============================================================================
-- Players in a tournament pairing or league-session pairing had exactly one
-- score path: create/link a real game and confirm it through the match bridge.
-- When nobody created a game (the common stall — see the Série 1 delay, where
-- 39% of pairings had to be advanced by the organizer), only the organizer
-- could act, via tournament_override_score / session_record_score.
--
-- This opens both RPCs to the pairing's own participants, with a strictly
-- narrower contract than the organizer's:
--
--   * the event must be live ('in_progress' tournament / active session) —
--     participants get no post-completion correction window
--   * the pairing must be unscored — participants record, never correct
--     (a wrong self-report is the organizer's to fix, inside existing guards)
--   * no game may be linked (match_id IS NULL) — if a game exists for the
--     matchup, its own score flow stays the single source of truth
--   * outcome 'completed' with a real score only — walkover, retired and
--     cancelled are organizer calls under the arbitration flow, and session
--     drill / three-player rows are excluded
--
-- The audit row distinguishes the paths: action 'player_record_score' for a
-- participant, 'override_score' unchanged for organizer/admin.
--
-- Bodies are copied from the LATEST definitions (tournament_override_score:
-- 20260829160000, session_record_score: 20260730170000) with only the gate and
-- the participant branch added.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_override_score(
    p_tournament_match_id    uuid,
    -- Defaulted because a cancellation has no winner: without it the generated
    -- client type demands a uuid the caller has nothing to put in.
    p_winner_registration_id uuid                    DEFAULT NULL,
    p_score                  text                    DEFAULT NULL,
    p_outcome                tournament_match_status DEFAULT 'completed'
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- How long after completion an organizer can still fix the final. Same
    -- constant as 20260729120000; the window is not what this migration changes.
    c_window constant interval := interval '24 hours';

    v_caller_id       uuid := auth.uid();
    v_tm              tournament_matches;
    v_t               tournaments;
    v_next            tournament_matches;
    v_row             tournament_matches;
    v_post_completion boolean := false;
    v_score           text    := p_score;
    v_winner          uuid    := p_winner_registration_id;
    v_is_org          boolean;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_outcome NOT IN ('completed', 'walkover', 'retired', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OUTCOME';
    END IF;

    SELECT * INTO v_tm FROM tournament_matches
     WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    v_is_org := public.is_tournament_organizer(v_tm.tournament_id) OR public.is_admin();

    IF NOT v_is_org THEN
        -- Participant self-report: the caller must be on one of the two
        -- registrations of THIS match (doubles partners included).
        IF NOT EXISTS (
            SELECT 1 FROM tournament_registrations tr
             WHERE tr.id IN (v_tm.player1_registration_id, v_tm.player2_registration_id)
               AND v_caller_id IN (tr.user_id, tr.partner_user_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
        END IF;
        -- Record, never correct: a fresh completed result with a real score,
        -- on a pairing that has no game bound to it. Everything else (walkover,
        -- retirement, cancellation, corrections, dispute resolution) stays an
        -- organizer call.
        IF p_outcome <> 'completed' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OUTCOME';
        END IF;
        IF v_tm.status NOT IN ('pending', 'in_progress')
           OR v_tm.winner_registration_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_OVERRIDABLE';
        END IF;
        IF v_tm.match_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
        END IF;
        IF p_score IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SCORE_REQUIRED';
        END IF;
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    IF v_t.status = 'in_progress' THEN
        v_post_completion := false;
    ELSIF v_t.status = 'completed' AND v_is_org THEN
        -- Grace window on the finished tournament, organizer-only: a
        -- participant on a completed tournament falls through to the refusal.
        -- A NULL completed_at means a pre-20260714120000 row that was never
        -- stamped; treat it as closed rather than guessing an anchor.
        IF v_t.completed_at IS NULL OR now() >= v_t.completed_at + c_window THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CORRECTION_WINDOW_CLOSED';
        END IF;
        v_post_completion := true;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Every settled shape is overridable, walkover and cancelled included: the
    -- automated ladder's calls have to be reversible from the app.
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed',
                           'completed', 'walkover', 'retired', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_OVERRIDABLE';
    END IF;

    IF v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_SLOTS_INCOMPLETE';
    END IF;

    -- Shape the write per outcome.
    IF p_outcome = 'cancelled' THEN
        -- A pool row nobody played counts for neither player. A bracket slot
        -- cannot simply vanish: somebody has to advance.
        IF v_tm.pool_number IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
                MESSAGE = 'CANCEL_NEEDS_BRACKET_OUTCOME';
        END IF;
        v_winner := NULL;
        v_score  := NULL;
    ELSE
        IF v_winner IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_REQUIRED';
        END IF;
        IF v_winner NOT IN (v_tm.player1_registration_id, v_tm.player2_registration_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_NOT_IN_MATCH';
        END IF;
        -- A walkover carries the format's forfeit score (Jean, 2026-08-23:
        -- 8-0 or 6-0 6-0), fixed by the format and not by the caller: an
        -- organizer holding a real score records completed or retired.
        IF p_outcome = 'walkover' THEN
            v_score := public.lt_forfeit_score(
                v_t.match_format, v_t.games_per_set, v_t.points_per_game,
                v_winner = v_tm.player1_registration_id);
        END IF;
    END IF;

    -- Correcting a row whose winner already advanced AND played on would
    -- invalidate that result.
    IF v_tm.next_match_id IS NOT NULL THEN
        SELECT * INTO v_next FROM tournament_matches
         WHERE id = v_tm.next_match_id FOR UPDATE;
        IF v_next.id IS NOT NULL
           AND (v_next.status = 'completed'
                OR v_next.winner_registration_id IS NOT NULL
                OR v_next.score IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NEXT_MATCH_ALREADY_PLAYED';
        END IF;
    END IF;

    UPDATE tournament_matches
       SET winner_registration_id = v_winner,
           score                  = v_score,
           status                 = p_outcome,
           -- A cancelled row was never played, so it keeps no played_at.
           played_at              = CASE WHEN p_outcome = 'cancelled' THEN NULL ELSE now() END,
           version                = version + 1,
           updated_at             = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_row.id,
        CASE WHEN v_is_org THEN 'override_score' ELSE 'player_record_score' END,
        v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'round', v_row.round_number,
            'position', v_row.match_position,
            'pool_number', v_row.pool_number,
            'outcome', p_outcome::text,
            'winner_registration_id', v_winner,
            'score', v_score,
            'previous_status', v_tm.status,
            'post_completion', v_post_completion
        )
    );

    IF v_winner IS NOT NULL THEN
        PERFORM public.lt_advance_tournament_winner(v_row.id, v_winner);
    END IF;

    -- Being walked over is news the loser cannot infer from the bracket.
    IF p_outcome = 'walkover' THEN
        PERFORM public.lt_notify_tournament_walkover(v_row.id, v_winner, false);
    END IF;

    IF v_post_completion THEN
        BEGIN
            PERFORM public.award_tournament_ranking_points(v_row.tournament_id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'award_tournament_ranking_points failed after correcting tournament %: %',
                v_row.tournament_id, SQLERRM;
        END;
    END IF;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status) IS
'Authoritative OUTCOME for a tournament_match. Organizer/admin: full override
(completed/walkover/retired/cancelled), corrections while the next match is
unplayed, and the final for 24h after completion. A participant of the match
may record a FRESH completed result on their own pairing (live tournament,
unscored row, no linked game, score required); everything else stays
organizer-only. Spec: specs/17-leagues-tournaments/score-entry.md.';

-- ----------------------------------------------------------------------------
-- League sessions — same opening, same restraint.
-- ----------------------------------------------------------------------------

-- Defaults reproduced exactly as the live function declares them. Omitting them
-- makes CREATE OR REPLACE fail ("cannot remove parameter defaults").
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
    v_is_org   boolean;
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

    v_is_org := public.is_league_organizer(v_season.league_id) OR public.is_admin();

    IF NOT v_is_org THEN
        -- Participant self-report on their own standard pairing only.
        IF NOT (v_caller = ANY (v_match.team_a_user_ids || v_match.team_b_user_ids)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
        END IF;
        IF v_match.is_drill OR v_match.is_three_player THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_SELF_SCOREABLE';
        END IF;
        -- Record, never correct: unscored pairing, no bound game, real score,
        -- and only a plain completed result (walkover/retired are organizer
        -- calls under the arbitration flow).
        IF v_match.status NOT IN ('pending', 'in_progress') OR v_match.winner_team IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_SCORED';
        END IF;
        IF v_match.match_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_ALREADY_LINKED';
        END IF;
        IF p_status <> 'completed' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
        END IF;
        IF p_score IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SCORE_REQUIRED';
        END IF;
        -- No post-completion correction window for participants.
        IF v_session.status NOT IN ('published', 'in_progress') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_ACTIVE';
        END IF;
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
        'session_match', v_row.id,
        CASE WHEN v_is_org THEN 'override_score' ELSE 'player_record_score' END,
        v_caller,
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
    'Score entry for a session match. Organizer/admin: full entry and correction, open for 24h after the session completes (CORRECTION_WINDOW_CLOSED past that). A participant of the pairing may record a FRESH completed result on their own row (active session, unscored, no bound game, score required); recalculates the season ranking on every call.';
