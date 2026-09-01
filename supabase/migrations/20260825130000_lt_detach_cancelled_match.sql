-- ============================================================================
-- L&T — cancelling the game must release the pairing that pointed at it
-- ============================================================================
-- Players organize a tournament pairing (or a league session row) by creating
-- a real game and linking it: tournament_attach_match_pre_play stamps
-- tournament_matches.match_id, session_attach_match_pre_play does the same on
-- session_matches. Cancelling that game only stamps match.cancelled_at. The
-- link survives its own target, and the pairing is then stranded three ways:
--
--   * re-linking is refused, because both attach RPCs raise ALREADY_LINKED
--     the moment match_id is not null;
--   * the nudges stop for good -- lt_send_tournament_deadline_nudges selects
--     `AND tm.match_id IS NULL`, so a pairing holding a dead link is read as
--     already organized and is never chased again;
--   * the swap and the resolver treat the row as spoken for.
--
-- The players' only way out was to ask the organizer to force a result, which
-- is how an unplayed pairing ends up wearing a made-up score.
--
-- Cancellation is a plain UPDATE on match.cancelled_at from the client
-- (matchService.cancelMatch), not an RPC, and it is reachable from more than
-- one path, so the release belongs in a trigger on match rather than in any
-- one caller. It fires only on the NULL -> NOT NULL transition, so a second
-- update of an already-cancelled row does nothing.
--
-- Only rows still waiting are released. A pairing whose result came from that
-- very game keeps its link: there the match_id is the provenance of a recorded
-- score, not a plan for a game to come.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lt_detach_cancelled_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- The audit's actor_id is NOT NULL, and a cancellation can arrive without a
    -- JWT (service role, a sweep). Falling back to the host who owns the game
    -- keeps the row attributable and, more importantly, stops a missing
    -- auth.uid() from failing the trigger and blocking the cancellation itself.
    v_actor uuid := COALESCE(auth.uid(), NEW.created_by);
    v_rec   record;
BEGIN
    FOR v_rec IN
        UPDATE tournament_matches
           SET match_id   = NULL,
               version    = version + 1,
               updated_at = now()
         WHERE match_id = NEW.id
           AND status IN ('pending', 'in_progress')
        RETURNING id, tournament_id
    LOOP
        INSERT INTO leagues_tournaments_audit
            (scope, entity_id, action, actor_id, payload_after)
        VALUES ('tournament_match', v_rec.id, 'detach_cancelled_match', v_actor,
                jsonb_build_object('tournament_id', v_rec.tournament_id,
                                   'match_id', NEW.id));
    END LOOP;

    FOR v_rec IN
        UPDATE session_matches
           SET match_id   = NULL,
               version    = version + 1,
               updated_at = now()
         WHERE match_id = NEW.id
           AND status = 'pending'
        RETURNING id, session_id
    LOOP
        INSERT INTO leagues_tournaments_audit
            (scope, entity_id, action, actor_id, payload_after)
        VALUES ('session', v_rec.id, 'detach_cancelled_match', v_actor,
                jsonb_build_object('session_id', v_rec.session_id,
                                   'match_id', NEW.id));
    END LOOP;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.lt_detach_cancelled_match() IS
'Releases any tournament_matches / session_matches row still waiting on a game
that has just been cancelled, so the pairing can be organized again and the
deadline nudges (which select on match_id IS NULL) resume. Settled rows keep
their link: there it is the provenance of a result, not a plan.';

DROP TRIGGER IF EXISTS lt_detach_cancelled_match_trigger ON public.match;

CREATE TRIGGER lt_detach_cancelled_match_trigger
    AFTER UPDATE OF cancelled_at ON public.match
    FOR EACH ROW
    WHEN (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
    EXECUTE FUNCTION public.lt_detach_cancelled_match();

-- ---------------------------------------------------------------------------
-- Backfill: the links already stranded by a cancellation
-- ---------------------------------------------------------------------------
-- Every pairing pointing at an already-cancelled game is in exactly the dead
-- state described above, and no code path will ever clear it. Measured on prod
-- 2026-08-25 the count is ZERO, so this is not a rescue: it is here because the
-- window between any cancellation and this deploy can still produce one, and
-- because staging and local carry their own. It is a no-op on a clean database.
WITH released AS (
    UPDATE tournament_matches tm
       SET match_id   = NULL,
           version    = version + 1,
           updated_at = now()
      FROM match m
     WHERE m.id = tm.match_id
       AND m.cancelled_at IS NOT NULL
       AND tm.status IN ('pending', 'in_progress')
    RETURNING tm.id, tm.tournament_id, m.id AS cancelled_match_id, m.created_by AS host_id
)
INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
SELECT 'tournament_match', r.id, 'detach_cancelled_match', r.host_id,
       jsonb_build_object('tournament_id', r.tournament_id,
                          'match_id', r.cancelled_match_id,
                          'backfill', true)
  FROM released r;

WITH released AS (
    UPDATE session_matches sm
       SET match_id   = NULL,
           version    = version + 1,
           updated_at = now()
      FROM match m
     WHERE m.id = sm.match_id
       AND m.cancelled_at IS NOT NULL
       AND sm.status = 'pending'
    RETURNING sm.id, sm.session_id, m.id AS cancelled_match_id, m.created_by AS host_id
)
INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
SELECT 'session', r.id, 'detach_cancelled_match', r.host_id,
       jsonb_build_object('session_id', r.session_id,
                          'match_id', r.cancelled_match_id,
                          'backfill', true)
  FROM released r;
