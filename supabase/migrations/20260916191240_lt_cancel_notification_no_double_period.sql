-- ============================================================================
-- Migration: Cancel notification no longer ends with a double period
-- Created: 2026-09-16
-- Description: notify_tournament_lifecycle appended '.' after the cancel
--              reason even when the reason already ended with one, so the
--              Série 3 Avancé cancel read "...threshold not met..". Recreated
--              from its latest definition (20260816240000); the period is now
--              added only when the reason does not already end a sentence.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_tournament_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rows jsonb;
  v_champion_name text;
BEGIN
  -- A) Bracket published: every member of every registered entry gets their
  --    round-1 matchup (or bye notice).
  IF OLD.status = 'registration_closed' AND NEW.status = 'in_progress' THEN
    -- A pool tournament publishes POOLS at this transition, not a knockout
    -- tree. Its round_number = 1 rows are pool games, so the single-elimination
    -- copy below would announce "round 1 vs X", and the join would silently
    -- skip whoever sits out round 1 in an odd pool. Hand off instead.
    IF NEW.bracket_type = 'pool_knockout' THEN
      PERFORM public.lt_notify_pools_published(NEW.id);
      RETURN NEW;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', r1.player_id,
      'type', 'tournament_bracket_published',
      'target_id', NEW.id,
      'title', CASE WHEN public.lt_user_is_fr(r1.player_id)
                 THEN 'Tableau dévoilé' ELSE 'Bracket published' END,
      'body', CASE WHEN public.lt_user_is_fr(r1.player_id)
                THEN CASE WHEN r1.opp_reg IS NULL
                       THEN NEW.name || ' : tu sautes le tour 1 et passes directement au suivant.'
                       ELSE NEW.name || ' : tour 1 contre '
                            || coalesce(public.lt_registration_display_name(r1.opp_reg), 'ton adversaire') || '.'
                     END
                ELSE CASE WHEN r1.opp_reg IS NULL
                       THEN NEW.name || ': you have a bye in round 1 and advance automatically.'
                       ELSE NEW.name || ': round 1 vs '
                            || coalesce(public.lt_registration_display_name(r1.opp_reg), 'your opponent') || '.'
                     END
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
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi annulé' ELSE 'Tournament cancelled' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' a été annulé'
                     || coalesce(' : ' || nullif(btrim(NEW.cancelled_reason), ''), '')
                     || CASE WHEN btrim(NEW.cancelled_reason) ~ '[.!?]$' THEN '' ELSE '.' END
                ELSE NEW.name || ' has been cancelled'
                     || coalesce(': ' || nullif(btrim(NEW.cancelled_reason), ''), '')
                     || CASE WHEN btrim(NEW.cancelled_reason) ~ '[.!?]$' THEN '' ELSE '.' END
              END,
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
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi terminé' ELSE 'Tournament complete' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' est terminé. Vainqueur : '
                     || coalesce(v_champion_name, 'à confirmer') || '. Merci d''avoir joué!'
                ELSE NEW.name || ' has wrapped up. Champion: '
                     || coalesce(v_champion_name, 'to be announced') || '. Thanks for playing!'
              END,
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
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi modifié' ELSE 'Tournament updated' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' : les dates ou le lieu ont changé. Va voir les détails à jour.'
                ELSE NEW.name || ': the dates or venue changed. Check the latest details.'
              END,
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
$function$;
