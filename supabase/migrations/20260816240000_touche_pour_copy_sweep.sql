-- ============================================================================
-- Migration: Sweep "Touche pour" translationese from SQL notification copy
-- Created: 2026-08-16
-- Description: Same rationale as 20260816230000: "Touche pour + verbe" is a
--              calque nobody writes. Every remaining live function whose copy
--              carried it is recreated from its latest applied definition with
--              a natural French CTA; English copy is untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_invite_members(p_league_id uuid, p_user_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_league       leagues;
    v_active_count integer;
    v_inviter_name text;
    v_uid          uuid;
    v_existing     league_members;
    v_member_id    uuid;
    v_invited      integer := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(p_league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    SELECT first_name INTO v_inviter_name FROM profile WHERE id = v_caller_id;

    SELECT count(*) INTO v_active_count
      FROM league_members WHERE league_id = p_league_id AND status = 'active';

    FOREACH v_uid IN ARRAY p_user_ids LOOP
        CONTINUE WHEN v_uid IS NULL OR v_uid = v_caller_id;
        EXIT WHEN v_league.member_capacity IS NOT NULL
                  AND v_active_count >= v_league.member_capacity
                  AND NOT COALESCE(v_league.waitlist_enabled, false);

        -- Must play the league's sport.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = v_uid AND ps.sport_id = v_league.sport_id AND ps.is_active = true
        );

        SELECT * INTO v_existing
          FROM league_members WHERE league_id = p_league_id AND user_id = v_uid;

        -- Already active / pending / suspended → don't double-invite.
        CONTINUE WHEN v_existing.id IS NOT NULL
                      AND v_existing.status IN ('active', 'pending', 'suspended');

        IF v_existing.id IS NOT NULL THEN
            -- Reactivate a former (inactive) row as a fresh invite.
            UPDATE league_members
               SET status      = 'pending',
                   role        = 'member',
                   invited_by  = v_caller_id,
                   approved_at = NULL,
                   approved_by = NULL,
                   left_at     = NULL,
                   version     = version + 1,
                   updated_at  = now()
             WHERE id = v_existing.id
            RETURNING id INTO v_member_id;
        ELSE
            INSERT INTO league_members (league_id, user_id, role, status, invited_by)
            VALUES (p_league_id, v_uid, 'member', 'pending', v_caller_id)
            RETURNING id INTO v_member_id;
        END IF;

        v_invited := v_invited + 1;

        PERFORM insert_notification(
            v_uid,
            'league_invitation',
            p_league_id,
            CASE WHEN public.lt_user_is_fr(v_uid) THEN 'Invitation à une ligue' ELSE 'League invitation' END,
            CASE WHEN public.lt_user_is_fr(v_uid)
                 THEN COALESCE(v_inviter_name, 'Un organisateur') || ' t''invite à '
                      || COALESCE(v_league.name, 'une ligue') || '. Ça te dit?'
                 ELSE COALESCE(v_inviter_name, 'An organizer') || ' invited you to '
                      || COALESCE(v_league.name, 'a league') || '. Tap to accept.'
            END,
            jsonb_build_object('entityKind', 'league', 'leagueId', p_league_id,
                               'leagueName', v_league.name, 'invitedBy', v_caller_id),
            'high'
        );

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('membership', v_member_id, 'invite_member', v_caller_id,
                jsonb_build_object('league_id', p_league_id, 'invitee', v_uid));
    END LOOP;

    RETURN v_invited;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.send_last_minute_spot_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer := 0;
  v_sent integer;
  v_player_group_type_id uuid;
  r record;
BEGIN
  SELECT id INTO v_player_group_type_id
  FROM network_type WHERE name = 'player_group' LIMIT 1;

  FOR r IN
    SELECT
      m.id,
      m.created_by,
      m.sport_id,
      m.facility_id,
      m.format,
      m.min_rating_score_id,
      m.preferred_opponent_gender,
      m.match_date,
      m.start_time,
      m.court_status,
      sp.name AS sport_name,
      CASE
        WHEN m.location_type = 'facility' THEN f.location
        WHEN m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
          )::extensions.geography
      END AS match_point,
      COALESCE(f.name, NULLIF(TRIM(m.location_name), '')) AS location_name,
      (m.match_date + m.start_time)
        AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC') AS start_ts,
      CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        - (SELECT count(*) FROM match_participant mp
            WHERE mp.match_id = m.id AND mp.status = 'joined') AS spots_left
    FROM public.match m
    LEFT JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp ON sp.id = m.sport_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND COALESCE(m.is_auto_generated, false) = false
  LOOP
    CONTINUE WHEN r.match_point IS NULL;
    CONTINUE WHEN r.start_ts <= now() + interval '2 hours'
             OR r.start_ts > now() + interval '6 hours';
    CONTINUE WHEN r.spots_left <= 0;

    WITH gate AS (
      SELECT COALESCE(
        r.min_rating_score_id,
        (SELECT prs.rating_score_id
           FROM player_sport hps
           JOIN player_rating_score prs ON prs.id = hps.active_rating_score_id
          WHERE hps.player_id = r.created_by AND hps.sport_id = r.sport_id
          LIMIT 1)
      ) AS rating_score_id
    ),
    group_members AS (
      SELECT DISTINCT nm2.player_id
      FROM network_member nm1
      JOIN network n ON n.id = nm1.network_id
                    AND n.network_type_id = v_player_group_type_id
      JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                             AND nm2.status = 'active'
      WHERE nm1.player_id = r.created_by
        AND nm1.status = 'active'
        AND v_player_group_type_id IS NOT NULL
    ),
    recipients AS (
      SELECT p.id AS user_id
      FROM player p, gate g
      WHERE p.id != r.created_by
        AND (
          (
            p.location IS NOT NULL
            AND p.max_travel_distance IS NOT NULL
            AND p.max_travel_distance > 0
            AND extensions.ST_DWithin(
                  p.location, r.match_point,
                  LEAST(p.max_travel_distance, 5) * 1000)
          )
          OR (
            r.facility_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM player_favorite_facility pff
              WHERE pff.player_id = p.id AND pff.facility_id = r.facility_id
            )
          )
        )
        AND p.id NOT IN (SELECT gm.player_id FROM group_members gm)
        AND p.id NOT IN (
          SELECT mp.player_id FROM match_participant mp WHERE mp.match_id = r.id
        )
        AND p.id IN (
          SELECT ps.player_id FROM player_sport ps
          WHERE ps.sport_id = r.sport_id AND ps.is_active = TRUE
        )
        -- One send ever per (match, player).
        AND NOT EXISTS (
          SELECT 1 FROM notification n
          WHERE n.user_id = p.id
            AND n.type = 'match_last_minute_spots'
            AND n.target_id = r.id
        )
        -- Shared discovery budget across nearby + last-minute pushes.
        AND (
          SELECT count(*)
          FROM notification n
          WHERE n.user_id = p.id
            AND n.type IN ('nearby_match_available', 'match_last_minute_spots')
            AND n.created_at >= now() - INTERVAL '7 days'
        ) < 3
        -- Exact-rating equality vs the gate rating (match min, else host).
        AND (
          g.rating_score_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM player_sport ps_rating
            JOIN player_rating_score prs ON prs.id = ps_rating.active_rating_score_id
            WHERE ps_rating.player_id = p.id
              AND ps_rating.sport_id  = r.sport_id
              AND prs.rating_score_id = g.rating_score_id
          )
        )
        AND (
          r.preferred_opponent_gender IS NULL
          OR p.gender = r.preferred_opponent_gender
        )
      ORDER BY
        -- Hot players first: declared availability covering the game hour.
        EXISTS (
          SELECT 1 FROM player_availability pa
          WHERE pa.player_id = p.id
            AND pa.is_active
            AND pa.day::text = trim(lower(to_char(r.match_date, 'day')))
            AND pa.hour_of_day = extract(hour FROM r.start_time)::int
        ) DESC,
        extensions.ST_Distance(p.location, r.match_point) ASC NULLS LAST
      LIMIT 20
    )
    INSERT INTO notification (user_id, type, title, body, payload, target_id, priority)
    SELECT
      rec.user_id,
      'match_last_minute_spots',
      CASE WHEN public.lt_user_is_fr(rec.user_id)
        THEN 'Ça commence bientôt · ' || COALESCE(r.sport_name, 'partie')
          || COALESCE(' à ' || r.location_name, '')
        ELSE 'Starting soon · ' || COALESCE(r.sport_name, 'game')
          || COALESCE(' at ' || r.location_name, '')
      END,
      CASE WHEN public.lt_user_is_fr(rec.user_id)
        THEN 'Aujourd''hui à ' || to_char(r.start_time, 'HH24:MI') || '. '
          || r.spots_left || CASE WHEN r.spots_left > 1 THEN ' places libres' ELSE ' place libre' END
          || CASE WHEN r.court_status = 'reserved'::public.court_status_enum
               THEN ' et le terrain est réservé.' ELSE '.' END
          || ' Embarque!'
        ELSE 'Today at ' || to_char(r.start_time, 'FMHH12:MI AM') || '. '
          || r.spots_left || CASE WHEN r.spots_left > 1 THEN ' spots open' ELSE ' spot open' END
          || CASE WHEN r.court_status = 'reserved'::public.court_status_enum
               THEN ' and the court is booked.' ELSE '.' END
          || ' Tap to join.'
      END,
      jsonb_build_object(
        'matchId', r.id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(r.match_date, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'locationName', r.location_name,
        'spotsLeft', r.spots_left,
        'courtReserved', (r.court_status = 'reserved'::public.court_status_enum)
      ),
      r.id,
      'high'
    FROM recipients rec;

    GET DIAGNOSTICS v_sent = ROW_COUNT;
    v_total := v_total + v_sent;
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_play_rhythm_nudges()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_tomorrow date := (CURRENT_DATE + 1);
  v_day text;
  v_day_fr text;
  r record;
BEGIN
  v_day := CASE EXTRACT(isodow FROM v_tomorrow)::int
    WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'  WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'  WHEN 5 THEN 'friday'   WHEN 6 THEN 'saturday'
    WHEN 7 THEN 'sunday' END;
  v_day_fr := CASE v_day
    WHEN 'monday' THEN 'lundi'      WHEN 'tuesday' THEN 'mardi'
    WHEN 'wednesday' THEN 'mercredi' WHEN 'thursday' THEN 'jeudi'
    WHEN 'friday' THEN 'vendredi'   WHEN 'saturday' THEN 'samedi'
    WHEN 'sunday' THEN 'dimanche' END;

  FOR r IN
    -- DISTINCT ON: a player with several free slots tomorrow still gets ONE nudge.
    SELECT DISTINCT ON (p.id)
      p.id AS user_id,
      pick.match_id,
      pick.start_time,
      pick.sport_name,
      pick.location_name
    FROM public.player p
    -- Player has a fresh declared slot tomorrow...
    JOIN LATERAL (
      SELECT pa.hour_of_day
      FROM public.player_availability pa
      WHERE pa.player_id = p.id
        AND pa.is_active
        AND pa.day::text = v_day
        AND COALESCE(pa.last_confirmed_at, pa.updated_at) >= now() - interval '14 days'
    ) slot ON TRUE
    -- ...with no commitment at that hour yet...
    JOIN LATERAL (
      SELECT 1 AS free
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.match_participant mp
        JOIN public.match mc ON mc.id = mp.match_id
        WHERE mp.player_id = p.id
          AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
          AND mc.cancelled_at IS NULL
          AND mc.match_date = v_tomorrow
          AND EXTRACT(hour FROM mc.start_time)::int = slot.hour_of_day
      )
    ) gap ON TRUE
    -- ...and one compatible open public game exists for the slot.
    JOIN LATERAL (
      SELECT m.id AS match_id, m.start_time, sp.name AS sport_name,
             COALESCE(f.name, NULLIF(TRIM(m.location_name), '')) AS location_name
      FROM public.match m
      JOIN public.sport sp ON sp.id = m.sport_id
      JOIN public.player_sport ps
        ON ps.player_id = p.id AND ps.sport_id = m.sport_id AND ps.is_active
      JOIN public.player_rating_score prs
        ON prs.id = ps.active_rating_score_id
       AND m.min_rating_score_id = prs.rating_score_id
      LEFT JOIN public.facility f ON f.id = m.facility_id AND f.is_active = TRUE
      WHERE m.visibility = 'public'
        AND m.cancelled_at IS NULL
        AND m.min_rating_score_id IS NOT NULL
        AND m.created_by <> p.id
        AND m.match_date = v_tomorrow
        AND EXTRACT(hour FROM m.start_time)::int = slot.hour_of_day
        AND (m.preferred_opponent_gender IS NULL OR m.preferred_opponent_gender = p.gender)
        AND (SELECT count(*) FROM match_participant mp2
              WHERE mp2.match_id = m.id AND mp2.status = 'joined')
            < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        AND NOT EXISTS (
          SELECT 1 FROM match_participant mp3
          WHERE mp3.match_id = m.id
            AND mp3.player_id = p.id
            AND mp3.status IN ('joined', 'requested', 'pending', 'waitlisted')
        )
        AND (
          (m.facility_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM player_favorite_facility pff
            WHERE pff.player_id = p.id AND pff.facility_id = m.facility_id))
          OR (
            p.location IS NOT NULL
            AND f.location IS NOT NULL
            AND extensions.ST_DWithin(
                  p.location, f.location,
                  LEAST(COALESCE(p.max_travel_distance, 10), 10) * 1000)
          )
        )
      ORDER BY
        EXISTS (SELECT 1 FROM player_favorite_facility pff2
                 WHERE pff2.player_id = p.id AND pff2.facility_id = m.facility_id) DESC,
        m.start_time ASC
      LIMIT 1
    ) pick ON TRUE
    WHERE COALESCE(p.push_notifications_enabled, true)
      -- Fatigue: one rhythm nudge per rolling week.
      AND NOT EXISTS (
        SELECT 1 FROM notification n
        WHERE n.user_id = p.id
          AND n.type = 'play_rhythm_nudge'
          AND n.created_at >= now() - interval '7 days'
      )
    ORDER BY p.id, pick.start_time ASC
    LIMIT 500
  LOOP
    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.user_id,
      'play_rhythm_nudge',
      CASE WHEN public.lt_user_is_fr(r.user_id)
        THEN 'Ton créneau du ' || v_day_fr || ' est libre'
        ELSE 'Your ' || initcap(v_day) || ' slot is open'
      END,
      CASE WHEN public.lt_user_is_fr(r.user_id)
        THEN 'Tu joues d''habitude le ' || v_day_fr || '. Une partie de '
          || COALESCE(r.sport_name, 'sport')
          || COALESCE(' à ' || r.location_name, '')
          || ' à ' || to_char(r.start_time, 'HH24:MI')
          || ' cherche encore des joueurs. Rejoins-la!'
        ELSE 'You usually play on ' || initcap(v_day) || 's. A '
          || COALESCE(r.sport_name, 'sports') || ' game'
          || COALESCE(' at ' || r.location_name, '')
          || ' at ' || to_char(r.start_time, 'FMHH12:MI AM')
          || ' still needs players. Tap to join.'
      END,
      jsonb_build_object(
        'matchId', r.match_id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(v_tomorrow, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'locationName', r.location_name
      ),
      r.match_id,
      'normal'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_unfilled_host_recovery()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_alt_matches integer;
  v_host_rating uuid;
  v_host_gender public.gender_enum;
  v_radius_km integer;
  v_title text;
  v_body text;
  r record;
BEGIN
  FOR r IN
    SELECT
      m.id, m.created_by, m.sport_id, m.facility_id, m.match_date,
      m.start_time, m.end_time, m.preferred_opponent_gender, m.player_expectation,
      sp.name AS sport_name,
      (m.match_date + m.start_time)
        AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC') AS start_ts
    FROM public.match m
    LEFT JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp ON sp.id = m.sport_id
    WHERE m.unfilled_recovery_sent_at IS NULL
      AND m.cancelled_at IS NULL
      AND COALESCE(m.is_auto_generated, false) = false
      -- Window filter must live in WHERE (not post-LIMIT) or a backlog of
      -- other unfilled matches can starve the eligible ones.
      AND (m.match_date + m.start_time)
            AT TIME ZONE COALESCE(f.timezone, m.timezone, 'UTC')
          BETWEEN now() - interval '6 hours' AND now()
      AND (SELECT count(*) FROM match_participant mp
            WHERE mp.match_id = m.id AND mp.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    LIMIT 100
  LOOP

    -- The host's level, gender and radius define the filters the tap will
    -- apply, so resolve them once and reuse them for both the count and the
    -- payload. The radius is bucketed to a value the filter can express.
    SELECT prs.rating_score_id INTO v_host_rating
    FROM public.player_sport ps
    JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
    WHERE ps.player_id = r.created_by AND ps.sport_id = r.sport_id
    LIMIT 1;

    SELECT p.gender,
           CASE
             WHEN LEAST(COALESCE(p.max_travel_distance, 10), 10) >= 10 THEN 10
             WHEN LEAST(COALESCE(p.max_travel_distance, 10), 10) >= 5  THEN 5
             ELSE 2
           END
      INTO v_host_gender, v_radius_km
    FROM public.player p WHERE p.id = r.created_by;

    SELECT count(*) INTO v_alt_matches
    FROM public.match m2
    JOIN public.facility f2 ON f2.id = m2.facility_id
    WHERE m2.visibility = 'public'
      AND m2.cancelled_at IS NULL
      AND m2.sport_id = r.sport_id
      AND m2.created_by != r.created_by
      -- dateRange = 'week'. The date bounds alone are not enough: they admit a
      -- game earlier today that has already started, which the screen does not
      -- list, so the start time has to be in the future too.
      AND m2.match_date >= (now() AT TIME ZONE COALESCE(m2.timezone, 'UTC'))::date
      AND m2.match_date <= (now() AT TIME ZONE COALESCE(m2.timezone, 'UTC'))::date
                           + INTERVAL '7 days'
      AND (m2.match_date + m2.start_time)
            AT TIME ZONE COALESCE(f2.timezone, m2.timezone, 'UTC') > now()
      -- Deliberately stricter than the screen: never count a game that is full.
      AND (SELECT count(*) FROM match_participant mp2
            WHERE mp2.match_id = m2.id AND mp2.status = 'joined')
          < CASE WHEN m2.format = 'doubles' THEN 4 ELSE 2 END
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp3
        WHERE mp3.match_id = m2.id AND mp3.player_id = r.created_by
      )
      -- rating = [host's score id]; a host with no rating sends no rating
      -- filter, so the count must not apply one either.
      AND (
        v_host_rating IS NULL
        OR m2.min_rating_score_id = v_host_rating
      )
      -- Mirrors the RPC's p_user_gender eligibility rule.
      AND (
        m2.preferred_opponent_gender IS NULL
        OR m2.preferred_opponent_gender = v_host_gender
      )
      -- distance = v_radius_km
      AND EXISTS (
        SELECT 1 FROM public.player ph
        WHERE ph.id = r.created_by
          AND ph.location IS NOT NULL
          AND f2.location IS NOT NULL
          AND extensions.ST_DWithin(ph.location, f2.location, v_radius_km * 1000)
      );

    IF public.lt_user_is_fr(r.created_by) THEN
      v_title := 'Ta partie ne s''est pas remplie';
      v_body := CASE
        WHEN v_alt_matches >= 1 THEN
          'Ça arrive. Il y a ' || v_alt_matches
          || CASE WHEN v_alt_matches > 1 THEN ' parties ouvertes' ELSE ' partie ouverte' END
          || ' près de toi dans les prochains jours. Trouve-toi la prochaine!'
        ELSE
          'Ça arrive. Va voir les parties ouvertes et remets-toi en jeu.'
      END;
    ELSE
      v_title := 'Your game didn''t fill this time';
      v_body := CASE
        WHEN v_alt_matches >= 1 THEN
          'It happens. There ' || CASE WHEN v_alt_matches > 1
            THEN 'are ' || v_alt_matches || ' open games'
            ELSE 'is 1 open game' END
          || ' near you in the coming days. Tap to find your next one.'
        ELSE
          'It happens. Tap to browse open games and get back out there.'
      END;
    END IF;

    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.created_by,
      'match_unfilled_recovery',
      v_title,
      v_body,
      jsonb_build_object(
        'matchId', r.id,
        'sportName', COALESCE(r.sport_name, ''),
        'matchDate', to_char(r.match_date, 'YYYY-MM-DD'),
        'startTime', to_char(r.start_time, 'HH24:MI'),
        'openMatchCount', v_alt_matches,
        -- Everything the tap needs to reproduce the counted set.
        'sportId', r.sport_id,
        'ratingScoreId', v_host_rating,
        'distanceKm', v_radius_km,
        'dateRange', 'week',
        'spotsAvailable', 'any'
      ),
      r.id,
      'high'
    );

    UPDATE public.match SET unfilled_recovery_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tournament_invite_players(p_tournament_id uuid, p_user_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_active_count integer;
    v_inviter_name text;
    v_uid          uuid;
    v_existing     tournament_registrations;
    v_reg_id       uuid;
    v_invited      integer := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT first_name INTO v_inviter_name FROM profile WHERE id = v_caller_id;

    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND status IN ('registered', 'pending');

    FOREACH v_uid IN ARRAY p_user_ids LOOP
        CONTINUE WHEN v_uid IS NULL OR v_uid = v_caller_id;
        EXIT WHEN v_active_count >= v_tournament.max_participants;

        -- Must play the sport.
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = v_uid
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        );

        -- Already an active partner on another entry → leave alone.
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id   = p_tournament_id
               AND r.partner_user_id = v_uid
               AND r.status IN ('registered', 'pending', 'waitlisted')
        );

        -- Their own captain row (UNIQUE per tournament + user), if any.
        SELECT * INTO v_existing
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id AND user_id = v_uid;

        -- Active (already in/invited) or organizer-removed (terminal) → skip.
        CONTINUE WHEN v_existing.id IS NOT NULL
                      AND v_existing.status IN ('registered', 'pending', 'waitlisted', 'disqualified');

        IF v_existing.id IS NOT NULL THEN
            -- Reactivate a withdrawn/revoked row as a fresh invite.
            UPDATE tournament_registrations
               SET status          = 'pending',
                   invited_by      = v_caller_id,
                   partner_user_id = NULL,
                   withdrawn_at    = NULL,
                   approved_at     = NULL,
                   version         = version + 1,
                   updated_at      = now()
             WHERE id = v_existing.id
            RETURNING id INTO v_reg_id;
        ELSE
            INSERT INTO tournament_registrations (tournament_id, user_id, status, invited_by)
            VALUES (p_tournament_id, v_uid, 'pending', v_caller_id)
            RETURNING id INTO v_reg_id;
        END IF;

        v_active_count := v_active_count + 1;
        v_invited      := v_invited + 1;

        PERFORM insert_notification(
            v_uid,
            'tournament_invitation',
            p_tournament_id,
            CASE WHEN public.lt_user_is_fr(v_uid) THEN 'Invitation à un tournoi' ELSE 'Tournament invitation' END,
            CASE WHEN public.lt_user_is_fr(v_uid)
              THEN COALESCE(v_inviter_name, 'Un organisateur') || ' t''invite à ' || COALESCE(v_tournament.name, 'un tournoi') || '. Ça te dit?'
              ELSE COALESCE(v_inviter_name, 'An organizer') || ' invited you to ' || COALESCE(v_tournament.name, 'a tournament') || '. Tap to accept.'
            END,
            jsonb_build_object('tournamentId', p_tournament_id, 'tournamentName', v_tournament.name, 'invitedBy', v_caller_id),
            'high'
        );

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('registration', v_reg_id, 'invite_player', v_caller_id,
                jsonb_build_object('tournament_id', p_tournament_id, 'invitee', v_uid));
    END LOOP;

    RETURN v_invited;
END;
$function$;
