-- ============================================================================
-- Leagues & Tournaments — localize lifecycle notification copy (fr-CA / en-US)
-- ============================================================================
-- These notifications are produced DB-side and previously stored English-only
-- title/body in the notification row, which then reached every surface verbatim
-- (in-app list, web, push, email). This migration localizes the stored copy per
-- recipient using their profile.preferred_locale, so fr-CA players get French.
--
-- Approach: a tiny `lt_user_is_fr(uuid)` helper, then each title/body literal
-- becomes `CASE WHEN lt_user_is_fr(<recipient>) THEN <fr> ELSE <en> END`. Query
-- shape, recipients, payloads, priorities and trigger bindings are unchanged —
-- only the two human-facing strings per notification move to a CASE.
--
-- Scope (10 notification types across 5 dedicated trigger functions):
--   tournament_bracket_published, tournament_cancelled, tournament_completed,
--   tournament_updated, tournament_match_completed,
--   tournament_registration_received/_approved/_removed,
--   session_published, season_closed
--
-- Deliberately NOT covered here (tracked separately):
--   * tournament_partner_registered / _withdrew — embedded inside the large
--     tournament_register / tournament_join_via_invite / tournament_withdraw
--     RPCs; localizing means rewriting those whole functions (higher risk).
--   * network_deleted — admin_delete_network passes p_data (column is payload)
--     inside an EXCEPTION-swallow, so it likely already fails silently; needs a
--     behavioral fix, not just copy, so it is excluded from this copy migration.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Locale helper: true when the recipient prefers French. NULL locale → en-US.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_user_is_fr(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT preferred_locale::text FROM profile WHERE id = p_user_id), 'en-US') LIKE 'fr%';
$$;

-- ===========================================================================
-- 1. Tournament lifecycle: bracket published / cancelled / completed / updated
-- ===========================================================================
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
      'title', CASE WHEN public.lt_user_is_fr(r1.player_id)
                 THEN 'Tableau dévoilé' ELSE 'Bracket published' END,
      'body', CASE WHEN public.lt_user_is_fr(r1.player_id)
                THEN CASE WHEN r1.opp_reg IS NULL
                       THEN NEW.name || ' : tu es exempté au tour 1, tu passes directement au suivant.'
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
                THEN NEW.name || ' est terminé. Champion : '
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
$$;

-- ===========================================================================
-- 2. Bracket-slot completion: loser "result recorded" + winner "you advanced"
-- ===========================================================================
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
    CASE WHEN public.lt_user_is_fr(m) THEN 'Résultat enregistré' ELSE 'Result recorded' END,
    CASE WHEN public.lt_user_is_fr(m)
      THEN v_t.name || ' : résultat du tour ' || NEW.round_number || ' enregistré'
           || coalesce(' (' || nullif(NEW.score, '') || ')', '') || '.'
      ELSE v_t.name || ': round ' || NEW.round_number || ' result recorded'
           || coalesce(' (' || nullif(NEW.score, '') || ')', '') || '.'
    END,
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
      CASE WHEN public.lt_user_is_fr(m) THEN 'Tu passes au tour suivant' ELSE 'You advanced' END,
      CASE WHEN public.lt_user_is_fr(m)
        THEN v_t.name || ' : tu accèdes au tour ' || v_next.round_number
             || coalesce(' contre ' || v_opp_name, ', adversaire à confirmer') || '.'
        ELSE v_t.name || ': you advanced to round ' || v_next.round_number
             || coalesce(' vs ' || v_opp_name, ', opponent to be determined') || '.'
      END,
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

-- ===========================================================================
-- 3. Registration phase: request received / approved / removed
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.notify_tournament_registration_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      CASE WHEN public.lt_user_is_fr(m) THEN 'Tu es inscrit' ELSE 'You''re in' END,
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
$$;

-- ===========================================================================
-- 4. Session published -> active league members
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_notify_session_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_league_id   uuid;
    v_league_name text;
    v_rows        jsonb;
BEGIN
    SELECT l.id, l.name INTO v_league_id, v_league_name
      FROM seasons se JOIN leagues l ON l.id = se.league_id
     WHERE se.id = NEW.season_id;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', lm.user_id,
        'type', 'session_published',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(lm.user_id)
                   THEN 'Nouvelle séance' ELSE 'New session' END,
        'body', CASE WHEN public.lt_user_is_fr(lm.user_id)
                  THEN coalesce(v_league_name, 'Ta ligue') || ' : confirme ta présence pour '
                       || NEW.name || '.'
                  ELSE coalesce(v_league_name, 'Your league') || ': confirm your spot for '
                       || NEW.name || '.'
                END,
        'payload', jsonb_build_object(
            'entityKind', 'session',
            'leagueId', v_league_id,
            'seasonId', NEW.season_id,
            'sessionId', NEW.id,
            'sessionName', NEW.name,
            'scheduledAt', NEW.scheduled_at,
            'confirmationDeadlineAt', NEW.confirmation_deadline_at,
            'venueName', NEW.venue_name
        ),
        'priority', 'normal'
    ))
    INTO v_rows
    FROM league_members lm
    WHERE lm.league_id = v_league_id AND lm.status = 'active';

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$$;

-- ===========================================================================
-- 5. Season closed -> ranked members with their final rank
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.tg_notify_season_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
                  THEN coalesce(v_league_name, 'Ta ligue') || ' : ' || NEW.name
                       || ' est terminée. Tu termines au rang #' || coalesce(sr.rank::text, '-') || '.'
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
$$;

COMMIT;
