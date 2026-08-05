-- ============================================================================
-- Leagues — paid seasons invited members who hadn't paid, into a dead end
-- ============================================================================
-- session_publish (20260618120000) seeds one 'pending' session_presence row per
-- ACTIVE LEAGUE MEMBER, and tg_notify_session_published (20260618150000) pushes
-- "confirm your spot" to the same list. Both predate season fees
-- (20260716200100) and neither looks at the season roster.
--
-- On a paid season that means every league member who has not paid gets a
-- presence row and a push. Tapping confirm calls session_confirm_presence,
-- which upserts them onto the season roster, and the paid gate
-- (tg_season_member_requires_payment) throws PAYMENT_REQUIRED. Verified
-- locally: a paid season with 3 active members and 0 payers published 3
-- presence rows, and the unpaid member's confirm raised PAYMENT_REQUIRED.
--
-- The gate itself is correct and stays — no unpaid player has ever slipped into
-- a paid roster. The defect is that we invite people to a night they are not
-- eligible for and only tell them at the last tap. The enrol-and-pay CTA lives
-- on the league screen, not on the session card, so the push points away from
-- the thing they actually need to do.
--
-- Fix: on a PAID season, seed and notify the season roster
-- (season_ranking_roster = enrolled, i.e. paid) instead of the league roster.
-- Free seasons keep the league-wide behaviour exactly as-is, which is what
-- makes a free league zero-friction. A member who pays after publish still gets
-- their row: session_confirm_presence inserts one on demand, and it is the same
-- call the confirm CTA already makes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_publish(
    p_session_id  uuid,
    p_deadline    timestamptz DEFAULT NULL,
    p_version_was integer     DEFAULT NULL
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_session   sessions;
    v_season    seasons;
    v_deadline  timestamptz;
    v_row       sessions;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_session.scheduled_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_START_PASSED';
    END IF;

    -- Explicit deadline must fall in (now, scheduled_at]; the default
    -- (scheduled_at - 24h) is clamped up to scheduled_at for short-notice
    -- sessions so the cron doesn't immediately close confirmations.
    IF p_deadline IS NOT NULL THEN
        IF p_deadline <= now() OR p_deadline > v_session.scheduled_at THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DEADLINE';
        END IF;
        v_deadline := p_deadline;
    ELSE
        v_deadline := v_session.scheduled_at - interval '24 hours';
        IF v_deadline <= now() THEN
            v_deadline := v_session.scheduled_at;
        END IF;
    END IF;

    UPDATE sessions
       SET status                   = 'published',
           confirmation_deadline_at = v_deadline,
           published_at             = now(),
           version                  = version + 1,
           updated_at               = now()
     WHERE id      = p_session_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM sessions WHERE id = p_session_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_DRAFT';
    END IF;

    -- One pending presence row per eligible player: the season roster on a paid
    -- season (only those who paid can play), every active league member on a
    -- free one.
    INSERT INTO session_presence (session_id, user_id, status)
    SELECT v_row.id, r.user_id, 'pending'
      FROM public.season_ranking_roster(v_season.id) r
    ON CONFLICT (session_id, user_id) DO NOTHING;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', v_row.id, 'publish', v_caller_id,
        jsonb_build_object('confirmation_deadline_at', v_row.confirmation_deadline_at)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_publish(uuid, timestamptz, integer) TO authenticated;


-- Notification list follows the same rule, so nobody is pushed a session they
-- cannot confirm. season_ranking_roster already resolves free -> active league
-- members and paid -> enrolled members.

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
        'user_id', r.user_id,
        'type', 'session_published',
        'target_id', NEW.id,
        'title', CASE WHEN public.lt_user_is_fr(r.user_id)
                   THEN 'Nouvelle séance' ELSE 'New session' END,
        'body', CASE WHEN public.lt_user_is_fr(r.user_id)
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
    FROM public.season_ranking_roster(NEW.season_id) r
    WHERE r.user_id IS DISTINCT FROM auth.uid();

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;

    RETURN NULL;
END;
$$;
