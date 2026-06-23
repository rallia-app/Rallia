-- ============================================================================
-- L&T notification copy polish (fr-CA naturalness)
-- ============================================================================
-- Follow-up to the localization migrations. Exact current pg_get_functiondef
-- output with only targeted FR string tweaks; EN output unchanged.
--   * bracket bye: "tu es exempté" (gendered) -> "tu sautes le tour 1" (neutral)
--   * tournament complete: "Champion :" -> "Vainqueur :" (reads gender-neutral)
--   * registration approved title: "Tu es inscrit" (gendered) -> "Inscription approuvée"
--   * season closed: prefix "la saison" so agreement holds regardless of the
--     season name's gender, and "Tu finis" to avoid the terminée/termines echo
-- ============================================================================

BEGIN;

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
                     || coalesce(' : ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                ELSE NEW.name || ' has been cancelled'
                     || coalesce(': ' || nullif(NEW.cancelled_reason, ''), '') || '.'
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
                THEN NEW.name || ' : les dates ou le lieu ont changé. Touche pour voir les détails à jour.'
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

CREATE OR REPLACE FUNCTION public.notify_tournament_registration_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_t_name text;
  v_registrant_name text;
  v_rows jsonb;
BEGIN
  SELECT name INTO v_t_name FROM tournaments WHERE id = NEW.tournament_id;

  -- A) New (or re-) pending request -> organizer side
  IF NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT trim(first_name || ' ' || coalesce(last_name, ''))
      INTO v_registrant_name
      FROM profile WHERE id = NEW.user_id;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', o.uid,
      'type', 'tournament_registration_received',
      'target_id', NEW.tournament_id,
      'title', CASE WHEN public.lt_user_is_fr(o.uid)
                 THEN 'Nouvelle demande d''inscription' ELSE 'New registration request' END,
      'body', CASE WHEN public.lt_user_is_fr(o.uid)
                THEN coalesce(nullif(v_registrant_name, ''), 'Un joueur')
                     || ' veut s''inscrire à ' || coalesce(v_t_name, 'ton tournoi') || '.'
                ELSE coalesce(nullif(v_registrant_name, ''), 'A player')
                     || ' wants to join ' || coalesce(v_t_name, 'your tournament') || '.'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.tournament_id,
        'tournamentName', v_t_name,
        'registrationId', NEW.id,
        'registrantId', NEW.user_id,
        'registrantName', v_registrant_name
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT t.organizer_id AS uid FROM tournaments t WHERE t.id = NEW.tournament_id
      UNION
      SELECT co.user_id FROM tournament_co_organizers co WHERE co.tournament_id = NEW.tournament_id
    ) o
    WHERE o.uid IS NOT NULL
      AND o.uid IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- B) Approved by someone outside the entry (organizer or future approval RPC)
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status = 'pending' AND NEW.status = 'registered'
        AND v_actor IS DISTINCT FROM NEW.user_id
        AND v_actor IS DISTINCT FROM NEW.partner_user_id THEN
    PERFORM insert_notification(
      m,
      'tournament_registration_approved',
      NEW.tournament_id,
      CASE WHEN public.lt_user_is_fr(m) THEN 'Inscription approuvée' ELSE 'You''re in' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN 'Ton inscription à ' || coalesce(v_t_name, 'ce tournoi') || ' a été approuvée.'
        ELSE 'Your registration for ' || coalesce(v_t_name, 'the tournament') || ' was approved.'
      END,
      jsonb_build_object('tournamentId', NEW.tournament_id, 'tournamentName', v_t_name),
      'high'
    )
    FROM unnest(array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL)) m;

  -- C) Removed by an organizer
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status = 'disqualified'
        AND OLD.status IN ('registered', 'pending', 'waitlisted') THEN
    PERFORM insert_notification(
      m,
      'tournament_registration_removed',
      NEW.tournament_id,
      CASE WHEN public.lt_user_is_fr(m) THEN 'Retiré du tournoi' ELSE 'Removed from tournament' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN 'Un organisateur t''a retiré de ' || coalesce(v_t_name, 'ce tournoi') || '.'
        ELSE 'An organizer removed you from ' || coalesce(v_t_name, 'the tournament') || '.'
      END,
      jsonb_build_object('tournamentId', NEW.tournament_id, 'tournamentName', v_t_name),
      'high'
    )
    FROM unnest(array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL)) m
    WHERE m IS DISTINCT FROM v_actor;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_notify_season_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_league_name text;
    v_rows        jsonb;
BEGIN
    SELECT l.name INTO v_league_name FROM leagues l WHERE l.id = NEW.league_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', sr.user_id,
        'type', 'season_closed',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(sr.user_id)
                   THEN 'Saison terminée' ELSE 'Season closed' END,
        'body', CASE WHEN public.lt_user_is_fr(sr.user_id)
                  THEN coalesce(v_league_name, 'Ta ligue') || ' : la saison ' || NEW.name
                       || ' est terminée. Tu finis au rang #' || coalesce(sr.rank::text, '-') || '.'
                  ELSE coalesce(v_league_name, 'Your league') || ' — ' || NEW.name
                       || ' is final. You finished #' || coalesce(sr.rank::text, '-') || '.'
                END,
        'payload', jsonb_build_object(
            'entityKind', 'season',
            'leagueId', NEW.league_id,
            'seasonId', NEW.id,
            'finalRank', sr.rank,
            'totalPoints', sr.points
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM season_rankings sr
    WHERE sr.season_id = NEW.id;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$function$;

COMMIT;
