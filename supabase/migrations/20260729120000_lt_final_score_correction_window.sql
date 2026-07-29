-- ============================================================================
-- Tournaments — the final score was permanently uncorrectable
-- ============================================================================
-- 20260622120300 opened correction on an already-completed MATCH, but left the
-- tournament-level guard alone:
--
--     IF v_t.status <> 'in_progress' THEN RAISE 'TOURNAMENT_NOT_IN_PROGRESS'
--
-- Recording the final flips the tournament to 'completed' (via
-- lt_advance_tournament_winner), so that guard fires on every subsequent call.
-- The whole bracket, not just the final, went read-only the instant the last
-- score was entered. A mistyped final permanently crowned the wrong champion,
-- and since tournaments_award_ranking fires on the same in_progress ->
-- completed transition, it also wrote Rallia points for that wrong champion.
-- There was no undo for the organizer and no confirmation before the submit.
--
-- This adds a grace window: an organizer may still correct while the
-- tournament is 'completed', for LT_FINAL_CORRECTION_WINDOW after completed_at.
--
--   * completed_at is stamped once, by tournaments_set_completed_at, on the
--     transition INTO completed and never again. So the window is measured from
--     the original completion and repeated corrections cannot extend it.
--   * In a completed tournament only the final is actually reachable anyway:
--     any earlier match trips NEXT_MATCH_ALREADY_PLAYED because its downstream
--     match already has a result. No extra "final only" guard needed.
--   * Past the window, the new CORRECTION_WINDOW_CLOSED distinguishes "too late"
--     from "wrong state". Cancelled/archived/draft still get
--     TOURNAMENT_NOT_IN_PROGRESS.
--
-- Ranking points are recomputed after a post-completion correction. The award
-- trigger only fires on the status transition, which does not happen again
-- here, so the call is explicit. award_tournament_ranking_points is idempotent
-- (it deletes the tournament's ledger rows and reinserts), and it resolves the
-- season from completed_at, so a correction cannot silently move a result into
-- a different ranking season. The call is wrapped the same way the trigger
-- wraps it: an award failure warns, it never rolls back the correction the
-- organizer just made.
--
-- Body is 20260622120300's definition plus the window branch and the re-award.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_override_score(
    p_tournament_match_id    uuid,
    p_winner_registration_id uuid,
    p_score                  text DEFAULT NULL
)
RETURNS tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- How long after completion an organizer can still fix the final.
    c_window   constant interval := interval '24 hours';

    v_caller_id uuid := auth.uid();
    v_tm        tournament_matches;
    v_next      tournament_matches;
    v_t         tournaments;
    v_row       tournament_matches;
    v_post_completion boolean := false;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Lock the match row so a concurrent verified-result propagation can't
    -- race us to completion.
    SELECT * INTO v_tm FROM tournament_matches WHERE id = p_tournament_match_id FOR UPDATE;
    IF v_tm.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_MATCH_NOT_FOUND';
    END IF;

    IF NOT public.is_tournament_organizer(v_tm.tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = v_tm.tournament_id;

    IF v_t.status = 'in_progress' THEN
        v_post_completion := false;
    ELSIF v_t.status = 'completed' THEN
        -- Grace window on the finished tournament. A NULL completed_at means a
        -- pre-20260714120000 row that was never stamped; treat it as closed
        -- rather than guessing an anchor.
        IF v_t.completed_at IS NULL OR now() >= v_t.completed_at + c_window THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CORRECTION_WINDOW_CLOSED';
        END IF;
        v_post_completion := true;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_IN_PROGRESS';
    END IF;

    -- Resolvable, including 'completed' so a recorded result can be corrected.
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed', 'completed') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_NOT_OVERRIDABLE';
    END IF;

    -- Both slots must hold a real registration — you can't decide a match
    -- whose opponents aren't both determined yet.
    IF v_tm.player1_is_bye OR v_tm.player2_is_bye
       OR v_tm.player1_registration_id IS NULL
       OR v_tm.player2_registration_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_SLOTS_INCOMPLETE';
    END IF;

    -- Winner must be one of the two assigned players.
    IF p_winner_registration_id NOT IN (v_tm.player1_registration_id, v_tm.player2_registration_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WINNER_NOT_IN_MATCH';
    END IF;

    -- Correction guard: once the winner has advanced and that downstream match
    -- has its own result, correcting here would invalidate it. Allow only while
    -- the next match is still unplayed (its slot may be pre-filled with the
    -- prior winner, but no result recorded). Lock it to avoid a race with a
    -- concurrent score entry on the next match.
    IF v_tm.next_match_id IS NOT NULL THEN
        SELECT * INTO v_next FROM tournament_matches WHERE id = v_tm.next_match_id FOR UPDATE;
        IF v_next.id IS NOT NULL
           AND (v_next.status = 'completed'
                OR v_next.winner_registration_id IS NOT NULL
                OR v_next.score IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NEXT_MATCH_ALREADY_PLAYED';
        END IF;
    END IF;

    UPDATE tournament_matches
       SET winner_registration_id = p_winner_registration_id,
           score                  = p_score,
           status                 = 'completed',
           played_at              = now(),
           version                = version + 1,
           updated_at             = now()
     WHERE id = p_tournament_match_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament_match', v_row.id, 'override_score', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'round', v_row.round_number,
            'position', v_row.match_position,
            'winner_registration_id', p_winner_registration_id,
            'score', p_score,
            'previous_status', v_tm.status,
            'post_completion', v_post_completion
        )
    );

    -- Walk the bracket forward. lt_advance_tournament_winner overwrites the
    -- next-match slot, so a corrected (changed) winner replaces the prior one.
    PERFORM public.lt_advance_tournament_winner(v_row.id, p_winner_registration_id);

    -- The tournament was already 'completed', so the award trigger's
    -- in_progress -> completed condition cannot fire again. Recompute here so
    -- the ledger follows the corrected champion.
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

GRANT EXECUTE ON FUNCTION public.tournament_override_score(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text) IS
    'Organizer/admin authoritative result for a tournament_match: sets the winner, completes the match, and propagates through the bracket. Corrects an already-completed match while its next match is unplayed (NEXT_MATCH_ALREADY_PLAYED otherwise), and corrects the final for 24h after the tournament completes (CORRECTION_WINDOW_CLOSED otherwise), recomputing ranking points. Spec: specs/17-leagues-tournaments/score-entry.md §Organizer override.';
