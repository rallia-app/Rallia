-- ============================================
-- Leagues & Tournaments — score correction window
-- ============================================
-- Extends tournament_override_score (20260527000100) so an organizer can also
-- CORRECT an already-completed match — but only while the result hasn't
-- propagated into a played downstream match. Concretely:
--   * 'completed' is now a resolvable status (was rejected as NOT_OVERRIDABLE).
--   * If the winner's next match already has its own result (completed, a
--     winner, or a score), correcting here would invalidate it → blocked with
--     NEXT_MATCH_ALREADY_PLAYED.
-- Re-advancement is handled by lt_advance_tournament_winner, which overwrites
-- the next-match slot with the (possibly changed) winner.
-- ============================================

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
    v_caller_id uuid := auth.uid();
    v_tm        tournament_matches;
    v_next      tournament_matches;
    v_t         tournaments;
    v_row       tournament_matches;
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
    IF v_t.status <> 'in_progress' THEN
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
            'previous_status', v_tm.status
        )
    );

    -- Walk the bracket forward. lt_advance_tournament_winner overwrites the
    -- next-match slot, so a corrected (changed) winner replaces the prior one.
    PERFORM public.lt_advance_tournament_winner(v_row.id, p_winner_registration_id);

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_override_score(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text) IS
    'Organizer/admin authoritative result for a tournament_match: sets the winner, completes the match, and propagates through the bracket. Also corrects an already-completed match while its next match is still unplayed (NEXT_MATCH_ALREADY_PLAYED otherwise). Spec: specs/17-leagues-tournaments/score-entry.md §Organizer override.';
