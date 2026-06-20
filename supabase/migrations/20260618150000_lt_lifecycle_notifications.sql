-- ============================================
-- Leagues & Tournaments — V10: lifecycle notifications (in-app + push)
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V10
--       specs/17-leagues-tournaments/notifications.md
--
-- Wires the two highest-value league lifecycle notifications via the standard
-- trigger -> insert_notifications -> on_notification_insert -> send-notification
-- path (mirrors notify_tournament_registration_change):
--   session_published  -> all active league members ("confirm your spot")
--   season_closed      -> all ranked members ("final standings / your rank")
--
-- The remaining league/session notification types (confirmation reminders,
-- waitlist promotion, sheet published, score disputed, etc.) follow this exact
-- trigger pattern and are deferred. Reminder cadences need crons (V10.1).
-- ============================================

-- New enum values (notification.type is notification_type_enum).
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'session_published';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'season_closed';


-- =====================
-- session published -> notify active members
-- =====================

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
        'title', 'New session',
        'body', coalesce(v_league_name, 'Your league') || ': confirm your spot for '
                || NEW.name || '.',
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

DROP TRIGGER IF EXISTS tg_notify_session_published ON sessions;
CREATE TRIGGER tg_notify_session_published
    AFTER UPDATE OF status ON sessions
    FOR EACH ROW
    WHEN (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published')
    EXECUTE FUNCTION public.tg_notify_session_published();


-- =====================
-- season closed -> notify ranked members with their final rank
-- =====================

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
        'title', 'Season closed',
        'body', coalesce(v_league_name, 'Your league') || ' — ' || NEW.name
                || ' is final. You finished #' || coalesce(sr.rank::text, '-') || '.',
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

DROP TRIGGER IF EXISTS tg_notify_season_closed ON seasons;
CREATE TRIGGER tg_notify_season_closed
    AFTER UPDATE OF status ON seasons
    FOR EACH ROW
    WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
    EXECUTE FUNCTION public.tg_notify_season_closed();
