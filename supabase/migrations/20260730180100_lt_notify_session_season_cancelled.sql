-- ============================================================================
-- Leagues — tell members when a session or a season is cancelled
-- ============================================================================
-- session_cancel and season_cancel both accept a reason and store it in
-- cancelled_reason, and neither notified anybody. Members saw a status flip if
-- they happened to reopen the screen, and nothing at all otherwise. Reported
-- from staging as "j'ai vu la saison annulee mais aucun avis aux membres" and,
-- for sessions, "je ne suis pas capable de voir ce que les joueurs qui avaient
-- deja confirme voient" — the answer was: nothing.
--
-- Tournaments have had this since 20260613120000 (tournament_cancelled, urgent,
-- to every invested entry). This gives leagues the same treatment, following
-- the existing session_published / season_closed triggers exactly: AFTER UPDATE
-- OF status with a WHEN clause on the transition, copy localized per recipient
-- through lt_user_is_fr, actor excluded, batched through insert_notifications.
--
-- Audiences differ on purpose:
--   * a cancelled SESSION goes to everyone holding a presence row that is not
--     'declined' — confirmed, still deciding, or waitlisted. Someone who already
--     said no does not need telling it is off.
--   * a cancelled SEASON goes to the season roster, the same audience
--     season_closed already uses.
--
-- Both are 'urgent': a cancellation invalidates a plan the member already made,
-- which is the same reasoning tournament_cancelled uses.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Session cancelled
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_notify_session_cancelled()
RETURNS TRIGGER
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
        'user_id', sp.user_id,
        'type', 'session_cancelled',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(sp.user_id)
                   THEN 'Séance annulée' ELSE 'Session cancelled' END,
        'body', CASE WHEN public.lt_user_is_fr(sp.user_id)
                  THEN NEW.name || ' a été annulée'
                       || coalesce(' : ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                  ELSE NEW.name || ' has been cancelled'
                       || coalesce(': ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                END,
        'payload', jsonb_build_object(
            'entityKind', 'session',
            'leagueId', v_league_id,
            'seasonId', NEW.season_id,
            'sessionId', NEW.id,
            'sessionName', NEW.name,
            'scheduledAt', NEW.scheduled_at,
            'reason', NEW.cancelled_reason
        ),
        'priority', 'urgent'
    ))
    INTO v_rows
    FROM session_presence sp
    WHERE sp.session_id = NEW.id
      AND sp.status <> 'declined'
      AND sp.user_id IS DISTINCT FROM auth.uid();

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_notify_session_cancelled ON public.sessions;
CREATE TRIGGER tg_notify_session_cancelled
    AFTER UPDATE OF status ON public.sessions
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled'::session_status
          AND OLD.status IS DISTINCT FROM 'cancelled'::session_status)
    EXECUTE FUNCTION public.tg_notify_session_cancelled();


-- --------------------------------------------------------------------------
-- 2. Season cancelled
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_notify_season_cancelled()
RETURNS TRIGGER
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
        'type', 'season_cancelled',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(sr.user_id)
                   THEN 'Saison annulée' ELSE 'Season cancelled' END,
        'body', CASE WHEN public.lt_user_is_fr(sr.user_id)
                  THEN coalesce(v_league_name, 'Ta ligue') || ' : ' || NEW.name
                       || ' a été annulée'
                       || coalesce(' : ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                  ELSE coalesce(v_league_name, 'Your league') || ': ' || NEW.name
                       || ' has been cancelled'
                       || coalesce(': ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                END,
        'payload', jsonb_build_object(
            'entityKind', 'season',
            'leagueId', NEW.league_id,
            'seasonId', NEW.id,
            'seasonName', NEW.name,
            'reason', NEW.cancelled_reason
        ),
        'priority', 'urgent'
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

DROP TRIGGER IF EXISTS tg_notify_season_cancelled ON public.seasons;
CREATE TRIGGER tg_notify_season_cancelled
    AFTER UPDATE OF status ON public.seasons
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled'::season_status
          AND OLD.status IS DISTINCT FROM 'cancelled'::season_status)
    EXECUTE FUNCTION public.tg_notify_season_cancelled();
