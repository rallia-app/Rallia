-- ============================================
-- Leagues & Tournaments — V4.x: tournament_override_score RPC
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V4 (tournament_override_score)
--       specs/17-leagues-tournaments/score-entry.md §Organizer override
--
-- The bridge flow (170010) advances the bracket only when a linked casual
-- match gets a *verified* result. If an opponent never confirms a score, or
-- the result is disputed, the tournament_match — and everything downstream —
-- stalls with no recovery path. This RPC gives the organizer (or admin) an
-- authoritative way to declare a winner and resolve the match, then walk the
-- bracket forward through the same propagation helper the verified-result
-- path uses.
--
-- It deliberately does NOT touch any linked casual `match` / `match_result`
-- row: the override is a bracket-level decision. The casual match keeps its
-- own (unverified / disputed) state for the players' history.
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

    -- Match must be resolvable (re-checked under the row lock).
    IF v_tm.status NOT IN ('pending', 'in_progress', 'disputed') THEN
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

    -- Walk the bracket forward (fills next slots, auto-completes phantom-fed
    -- slots, completes the tournament if this was the final).
    PERFORM public.lt_advance_tournament_winner(v_row.id, p_winner_registration_id);

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_override_score(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text) IS
    'Organizer/admin authoritative result for a stalled or disputed tournament_match. Sets the winner, completes the match, and propagates through the bracket. Does not modify any linked casual match row. Spec: specs/17-leagues-tournaments/score-entry.md §Organizer override.';
