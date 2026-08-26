-- ============================================================================
-- Tournaments — the organizer records an OUTCOME, not a score standing in for one
-- ============================================================================
-- Série 1, prod: 27 of 70 pairings (39%) were advanced by the organizer typing
-- a generic 8-6, or a 1-0 / 8-0 placeholder, because tournament_override_score
-- could only ever write status='completed' with a free-text score. The app had
-- no way to say "nobody played this". The cost is not cosmetic: the record
-- disguised the unplayed third as real results, which is why the Série 1
-- census had to be corrected twice and why silence could not be told apart
-- from play. Série 2 is live and paid, and its pool deadline lands with the
-- resolver parked in dry-run, so the organizer will settle those rows by hand.
--
-- Three changes:
--
--   1. p_outcome names what happened: completed (a real score, unchanged
--      behaviour), walkover, retired, or cancelled. Every one of them is a
--      value tournament_match_status already carried and that the standings
--      already read correctly -- tournament_pool_standings counts completed,
--      retired and walkover, scores a walkover as a win with played = 0, and
--      ignores cancelled entirely. Nothing downstream needed teaching.
--
--   2. A row already sitting in walkover, retired or cancelled becomes
--      overridable. The automated ladder writes walkovers, and until now its
--      decision was final because MATCH_NOT_OVERRIDABLE refused the only path
--      back. An organizer must be able to undo a machine's call.
--
--   3. cancelled is refused on a knockout row (CANCEL_NEEDS_BRACKET_OUTCOME).
--      A pool row that nobody played simply does not count, but a bracket slot
--      has to send somebody forward or the draw stalls; that case is the
--      double walkover with its bye cascade, which is the resolver's job, not
--      a status flip. Spec: unplayed-match-resolution.md, outcomes per format.
--
-- Deliberately NOT mirrored from the automated path: the -15
-- 'tournament_unresponsive' reputation hit. The resolver applies it because it
-- has just proven both sides ignored every nudge; an organizer recording an
-- injury walkover is asserting nothing of the kind, and a penalty they did not
-- ask for would make them avoid the honest button and go back to typing 8-6.
--
-- The signature gains a parameter, so the old one is DROPped rather than
-- replaced: CREATE OR REPLACE would leave the 3-argument version in place as a
-- second overload and make the PostgREST call ambiguous.
-- ============================================================================

DROP FUNCTION IF EXISTS public.tournament_override_score(uuid, uuid, text);

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
        -- A walkover has no score to report. Stamping the same 'W/O' the
        -- resolver writes keeps hand-settled and machine-settled rows
        -- indistinguishable to every reader downstream.
        IF p_outcome = 'walkover' AND coalesce(trim(v_score), '') = '' THEN
            v_score := 'W/O';
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
        'tournament_match', v_row.id, 'override_score', v_caller_id,
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

REVOKE ALL ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status)
    TO authenticated;

COMMENT ON FUNCTION public.tournament_override_score(uuid, uuid, text, tournament_match_status) IS
'Organizer/admin authoritative OUTCOME for a tournament_match. p_outcome is one
of completed (a real score), walkover (score defaults to the resolver''s W/O),
retired (the score at retirement) or cancelled (pool only, no winner, no
played_at, counts for neither player). Overrides a row in any settled state,
walkover included, so an automated resolution can be undone. Refuses cancelled
on a knockout row (CANCEL_NEEDS_BRACKET_OUTCOME): a bracket slot must send
somebody forward. Applies no reputation penalty, unlike the automated ladder.
Corrects while the next match is unplayed (NEXT_MATCH_ALREADY_PLAYED) and for
24h after the tournament completes (CORRECTION_WINDOW_CLOSED). Spec:
specs/17-leagues-tournaments/unplayed-match-resolution.md §Organizer override.';
