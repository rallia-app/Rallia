-- ============================================
-- Leagues — notifications skip the acting user
-- ============================================
-- A player should not be notified about an action they performed. The league
-- lifecycle triggers notified every active member / ranked member, including
-- the organizer who published the session or closed the season. (The existing
-- self-suppression in 20260625090000 is chat-message-specific and does not
-- cover these triggers.)
--
-- Bodies preserve the localized copy from 20260623170000 / 20260624100000;
-- the only change is the NULL-safe `user_id IS DISTINCT FROM auth.uid()` filter
-- on the recipient set (for a system/cron status change auth.uid() = NULL, so
-- every member is still notified).
-- ============================================

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
    WHERE lm.league_id = v_league_id
      AND lm.status = 'active'
      AND lm.user_id IS DISTINCT FROM auth.uid();

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$$;


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
    WHERE sr.season_id = NEW.id
      AND sr.user_id IS DISTINCT FROM auth.uid();

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$$;
