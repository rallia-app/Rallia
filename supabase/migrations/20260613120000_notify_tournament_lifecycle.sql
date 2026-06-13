-- Tournament lifecycle notifications, derived from status transitions and
-- impactful field changes on tournaments, plus bracket-slot completions.
--
--   tournaments AFTER UPDATE:
--     registration_closed -> in_progress   bracket published (+ round-1 opponent)
--     * -> cancelled                        urgent, to all invested entries
--     in_progress -> completed              champion announcement
--     impactful edits (dates/venue)         to registered entries
--     (fills the participant-notification TODO deferred in 20260612090000)
--
--   tournament_matches: deferred CONSTRAINT trigger so it fires at COMMIT,
--   after lt_advance_tournament_winner has filled the next-round slot.

BEGIN;

-- =============================================================================
-- 1. Entry display name helper (captain, plus partner for doubles)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lt_registration_display_name(p_registration_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trim(p1.first_name || ' ' || coalesce(p1.last_name, ''))
         || coalesce(' & ' || nullif(trim(p2.first_name || ' ' || coalesce(p2.last_name, '')), ''), '')
  FROM tournament_registrations r
  JOIN profile p1 ON p1.id = r.user_id
  LEFT JOIN profile p2 ON p2.id = r.partner_user_id
  WHERE r.id = p_registration_id;
$$;

-- =============================================================================
-- 2. tournaments lifecycle trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_tournament_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rows jsonb;
  v_champion_name text;
BEGIN
  -- A) Bracket published: every member of every registered entry gets their
  --    round-1 matchup (or bye notice).
  IF OLD.status = 'registration_closed' AND NEW.status = 'in_progress' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', r1.player_id,
      'type', 'tournament_bracket_published',
      'target_id', NEW.id,
      'title', 'Bracket published',
      'body', CASE WHEN r1.opp_reg IS NULL
                THEN NEW.name || ': you have a bye in round 1 and advance automatically.'
                ELSE NEW.name || ': round 1 vs '
                     || coalesce(public.lt_registration_display_name(r1.opp_reg), 'your opponent') || '.'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'round', 1,
        'opponentRegistrationId', r1.opp_reg,
        'opponentName', public.lt_registration_display_name(r1.opp_reg)
      ),
      'priority', 'high'
    ))
    INTO v_rows
    FROM (
      SELECT mem.player_id,
             CASE WHEN tm.player1_registration_id = mem.reg_id
                  THEN tm.player2_registration_id
                  ELSE tm.player1_registration_id
             END AS opp_reg
      FROM (
        SELECT r.id AS reg_id, m AS player_id
        FROM tournament_registrations r
        CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
        WHERE r.tournament_id = NEW.id AND r.status = 'registered'
      ) mem
      JOIN tournament_matches tm
        ON tm.tournament_id = NEW.id
       AND tm.round_number = 1
       AND mem.reg_id IN (tm.player1_registration_id, tm.player2_registration_id)
    ) r1;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- B) Cancelled: everyone with an invested entry, urgent.
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_cancelled',
      'target_id', NEW.id,
      'title', 'Tournament cancelled',
      'body', NEW.name || ' has been cancelled'
              || coalesce(': ' || nullif(NEW.cancelled_reason, ''), '') || '.',
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'reason', NEW.cancelled_reason
      ),
      'priority', 'urgent'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id
        AND r.status IN ('registered', 'pending', 'waitlisted')
    ) mem
    WHERE mem.player_id IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- C) Completed: champion announcement to all registered entries.
  ELSIF OLD.status = 'in_progress' AND NEW.status = 'completed' THEN
    SELECT public.lt_registration_display_name(fm.winner_registration_id)
      INTO v_champion_name
      FROM tournament_matches fm
     WHERE fm.tournament_id = NEW.id
       AND fm.next_match_id IS NULL
       AND fm.bracket_side = 'main'
       AND fm.winner_registration_id IS NOT NULL
     LIMIT 1;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_completed',
      'target_id', NEW.id,
      'title', 'Tournament complete',
      'body', NEW.name || ' has wrapped up. Champion: '
              || coalesce(v_champion_name, 'to be announced') || '. Thanks for playing!',
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'championName', v_champion_name
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id AND r.status = 'registered'
    ) mem;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- D) Impactful edits while the tournament is live: dates / venue.
  ELSIF NEW.status = OLD.status
        AND NEW.status IN ('registration_open', 'registration_closed', 'in_progress')
        AND (OLD.start_date IS DISTINCT FROM NEW.start_date
             OR OLD.end_date IS DISTINCT FROM NEW.end_date
             OR OLD.venue_name IS DISTINCT FROM NEW.venue_name
             OR OLD.venue_address IS DISTINCT FROM NEW.venue_address
             OR OLD.facility_id IS DISTINCT FROM NEW.facility_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_updated',
      'target_id', NEW.id,
      'title', 'Tournament updated',
      'body', NEW.name || ': the dates or venue changed. Check the latest details.',
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'changedFields', (
          SELECT jsonb_agg(f) FROM unnest(ARRAY[
            CASE WHEN OLD.start_date IS DISTINCT FROM NEW.start_date THEN 'start_date' END,
            CASE WHEN OLD.end_date IS DISTINCT FROM NEW.end_date THEN 'end_date' END,
            CASE WHEN OLD.venue_name IS DISTINCT FROM NEW.venue_name THEN 'venue_name' END,
            CASE WHEN OLD.venue_address IS DISTINCT FROM NEW.venue_address THEN 'venue_address' END,
            CASE WHEN OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN 'facility_id' END
          ]) f WHERE f IS NOT NULL
        )
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id AND r.status = 'registered'
    ) mem
    WHERE mem.player_id IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_notify_lifecycle ON public.tournaments;
CREATE TRIGGER tournaments_notify_lifecycle
  AFTER UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tournament_lifecycle();

-- =============================================================================
-- 3. Bracket-slot completion: deferred so it runs after winner advancement.
--    The WHEN guard excludes BYE/phantom auto-completions (they always carry a
--    bye flag or a NULL slot).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_tournament_match_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_t tournaments;
  v_loser_reg uuid;
  v_next tournament_matches;
  v_opp_reg uuid;
  v_opp_name text;
  v_winner_members uuid[];
  v_loser_members uuid[];
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = NEW.tournament_id;
  IF v_t.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_loser_reg := CASE WHEN NEW.winner_registration_id = NEW.player1_registration_id
                      THEN NEW.player2_registration_id
                      ELSE NEW.player1_registration_id
                 END;

  SELECT array_remove(ARRAY[r.user_id, r.partner_user_id], NULL) INTO v_winner_members
    FROM tournament_registrations r WHERE r.id = NEW.winner_registration_id;
  SELECT array_remove(ARRAY[r.user_id, r.partner_user_id], NULL) INTO v_loser_members
    FROM tournament_registrations r WHERE r.id = v_loser_reg;

  -- Loser side: result recorded.
  PERFORM insert_notification(
    m,
    'tournament_match_completed',
    NEW.tournament_id,
    'Result recorded',
    v_t.name || ': round ' || NEW.round_number || ' result recorded'
      || coalesce(' (' || nullif(NEW.score, '') || ')', '') || '.',
    jsonb_build_object(
      'tournamentId', NEW.tournament_id,
      'tournamentName', v_t.name,
      'tournamentMatchId', NEW.id,
      'round', NEW.round_number,
      'score', NEW.score,
      'won', false
    ),
    'normal'
  )
  FROM unnest(coalesce(v_loser_members, '{}')) m
  WHERE m IS DISTINCT FROM v_actor;

  -- Winner side: advancement info. Re-read live state (the deferred firing
  -- runs after advancement, and phantom byes can skip rounds). Winning the
  -- final is covered by tournament_completed instead.
  SELECT * INTO v_next
    FROM tournament_matches tm
   WHERE tm.tournament_id = NEW.tournament_id
     AND tm.status NOT IN ('completed', 'cancelled')
     AND (tm.player1_registration_id = NEW.winner_registration_id
          OR tm.player2_registration_id = NEW.winner_registration_id)
   ORDER BY tm.round_number
   LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    v_opp_reg := CASE WHEN v_next.player1_registration_id = NEW.winner_registration_id
                      THEN v_next.player2_registration_id
                      ELSE v_next.player1_registration_id
                 END;
    v_opp_name := public.lt_registration_display_name(v_opp_reg);

    PERFORM insert_notification(
      m,
      'tournament_match_completed',
      NEW.tournament_id,
      'You advanced',
      v_t.name || ': you advanced to round ' || v_next.round_number
        || coalesce(' vs ' || v_opp_name, ', opponent to be determined') || '.',
      jsonb_build_object(
        'tournamentId', NEW.tournament_id,
        'tournamentName', v_t.name,
        'tournamentMatchId', v_next.id,
        'round', v_next.round_number,
        'opponentRegistrationId', v_opp_reg,
        'opponentName', v_opp_name,
        'won', true
      ),
      'high'
    )
    FROM unnest(coalesce(v_winner_members, '{}')) m
    WHERE m IS DISTINCT FROM v_actor;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tournament_match_notify_completed ON public.tournament_matches;
CREATE CONSTRAINT TRIGGER tournament_match_notify_completed
  AFTER UPDATE ON public.tournament_matches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
        AND NEW.winner_registration_id IS NOT NULL
        AND NOT NEW.player1_is_bye AND NOT NEW.player2_is_bye
        AND NEW.player1_registration_id IS NOT NULL
        AND NEW.player2_registration_id IS NOT NULL)
  EXECUTE FUNCTION public.notify_tournament_match_completed();

COMMIT;
