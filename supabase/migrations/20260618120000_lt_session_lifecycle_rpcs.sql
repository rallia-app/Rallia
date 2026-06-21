-- ============================================
-- Leagues & Tournaments — V7: session lifecycle RPCs
-- ============================================
-- Spec: specs/17-leagues-tournaments/rollout.md §V7
--       specs/17-leagues-tournaments/leagues.md §Sessions
--
-- Ships (Core + cancel slice):
--   session_create            draft session within an OPEN season
--   session_publish           draft -> published, seeds pending presence rows
--   session_confirm_presence  member confirm/decline (+ capacity/waitlist)
--   session_cancel            draft|published|in_progress -> cancelled
--   lt_close_due_session_confirmations()  cron: pending -> declined at deadline
--   tg_session_presence_promote_waitlist  trigger: fill freed seats from waitlist
--
-- Notifications/push are deferred to V10, following the V5 precedent
-- (lt_close_due_tournament_registrations ships as pure SQL). Reschedule,
-- guest invites and suspension crons are out of this slice.
-- ============================================


-- =====================
-- session_create
-- =====================
-- formats_allowed and match_format default from the season's frozen rules.

CREATE OR REPLACE FUNCTION public.session_create(
    p_season_id        uuid,
    p_name             text,
    p_scheduled_at     timestamptz,
    p_timezone         text         DEFAULT NULL,
    p_duration_minutes smallint     DEFAULT 90,
    p_facility_id      uuid         DEFAULT NULL,
    p_venue_name       text         DEFAULT NULL,
    p_capacity         smallint     DEFAULT NULL,
    p_rounds           smallint     DEFAULT 1,
    p_pairing_mode     pairing_mode DEFAULT 'by_rank'
)
RETURNS sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_season       seasons;
    v_league       leagues;
    v_formats      entry_format[];
    v_match_format match_format;
    v_tz           text;
    v_row          sessions;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_season.league_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_season.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    IF length(coalesce(trim(p_name), '')) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_scheduled_at IS NULL OR p_scheduled_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_SCHEDULE';
    END IF;

    -- Formats / match format inherit the season's frozen rules.
    v_formats := COALESCE(
        (SELECT array_agg(value::entry_format)
           FROM jsonb_array_elements_text(v_season.rules -> 'formatsAllowed')),
        ARRAY['singles']::entry_format[]
    );
    v_match_format := NULLIF(v_season.rules ->> 'matchFormat', '')::match_format;

    v_tz := COALESCE(NULLIF(p_timezone, ''), 'America/Toronto');

    INSERT INTO sessions (
        season_id, name, scheduled_at, duration_minutes, timezone,
        facility_id, venue_name, capacity, rounds,
        formats_allowed, match_format, pairing_mode, status
    )
    VALUES (
        p_season_id, p_name, p_scheduled_at, COALESCE(p_duration_minutes, 90), v_tz,
        COALESCE(p_facility_id, v_league.facility_id),
        COALESCE(p_venue_name, v_league.venue_name),
        p_capacity, COALESCE(p_rounds, 1),
        v_formats, v_match_format, COALESCE(p_pairing_mode, 'by_rank'), 'draft'
    )
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', v_row.id, 'create', v_caller_id,
        jsonb_build_object(
            'season_id', p_season_id,
            'name', v_row.name,
            'scheduled_at', v_row.scheduled_at
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_create(
    uuid, text, timestamptz, text, smallint, uuid, text, smallint, smallint, pairing_mode
) TO authenticated;


-- =====================
-- session_publish
-- =====================

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

    -- One pending presence row per active league member.
    INSERT INTO session_presence (session_id, user_id, status)
    SELECT v_row.id, lm.user_id, 'pending'
      FROM league_members lm
     WHERE lm.league_id = v_season.league_id
       AND lm.status = 'active'
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


-- =====================
-- session_confirm_presence
-- =====================
-- Caller sets their own presence to confirmed/declined/pending. When the
-- session has a capacity and confirmed seats are full, a confirm becomes
-- waitlisted. A freed seat is filled by tg_session_presence_promote_waitlist.

CREATE OR REPLACE FUNCTION public.session_confirm_presence(
    p_session_id uuid,
    p_status     session_presence_status,
    p_partner_id uuid DEFAULT NULL
)
RETURNS session_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_session   sessions;
    v_season    seasons;
    v_existing  session_presence;
    v_target    session_presence_status;
    v_confirmed integer;
    v_position  integer;
    v_row       session_presence;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_status NOT IN ('confirmed', 'declined', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_STATUS';
    END IF;

    SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    IF v_session.confirmation_deadline_at IS NOT NULL
       AND now() > v_session.confirmation_deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIRMATION_CLOSED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_session.season_id;

    IF NOT public.is_active_league_member(v_season.league_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    SELECT * INTO v_existing
      FROM session_presence
     WHERE session_id = p_session_id AND user_id = v_caller_id;

    -- Capacity gate: a confirm past capacity goes to the waitlist (the caller's
    -- own current seat doesn't count against the cap).
    v_target := p_status;
    v_position := NULL;
    IF p_status = 'confirmed' AND v_session.capacity IS NOT NULL THEN
        SELECT count(*) INTO v_confirmed
          FROM session_presence
         WHERE session_id = p_session_id
           AND status = 'confirmed'
           AND user_id <> v_caller_id;

        IF v_confirmed >= v_session.capacity THEN
            v_target := 'waitlisted';
            SELECT COALESCE(max(waitlist_position), 0) + 1 INTO v_position
              FROM session_presence
             WHERE session_id = p_session_id AND status = 'waitlisted';
        END IF;
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE session_presence
           SET status            = v_target,
               preferred_partner_id = p_partner_id,
               waitlist_position = v_position,
               responded_at      = now(),
               version           = version + 1,
               updated_at        = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO session_presence (
            session_id, user_id, status, preferred_partner_id,
            waitlist_position, responded_at
        )
        VALUES (
            p_session_id, v_caller_id, v_target, p_partner_id,
            v_position, now()
        )
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_confirm_presence(uuid, session_presence_status, uuid)
    TO authenticated;


-- =====================
-- session_cancel
-- =====================

CREATE OR REPLACE FUNCTION public.session_cancel(
    p_session_id  uuid,
    p_reason      text    DEFAULT NULL,
    p_version_was integer DEFAULT NULL
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

    UPDATE sessions
       SET status           = 'cancelled',
           cancelled_at     = now(),
           cancelled_reason = p_reason,
           version          = version + 1,
           updated_at       = now()
     WHERE id      = p_session_id
       AND version = p_version_was
       AND status IN ('draft', 'published', 'in_progress')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM sessions WHERE id = p_session_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_CANCELLABLE';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'session', v_row.id, 'cancel', v_caller_id,
        jsonb_build_object('reason', p_reason)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_cancel(uuid, text, integer) TO authenticated;


-- =====================
-- tg_session_presence_promote_waitlist
-- =====================
-- When a confirmed seat frees up (a member declines after confirming) and the
-- session is under capacity before its deadline, promote the lowest-positioned
-- waitlisted member. The promotion sets status -> confirmed, whose OLD.status
-- is 'waitlisted', so the WHEN clause keeps the trigger from recursing.

CREATE OR REPLACE FUNCTION public.tg_session_presence_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_capacity  smallint;
    v_deadline  timestamptz;
    v_confirmed integer;
    v_promote   uuid;
BEGIN
    SELECT capacity, confirmation_deadline_at
      INTO v_capacity, v_deadline
      FROM sessions WHERE id = NEW.session_id;

    IF v_capacity IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_deadline IS NOT NULL AND now() > v_deadline THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_confirmed
      FROM session_presence
     WHERE session_id = NEW.session_id AND status = 'confirmed';
    IF v_confirmed >= v_capacity THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_promote
      FROM session_presence
     WHERE session_id = NEW.session_id AND status = 'waitlisted'
     ORDER BY waitlist_position ASC NULLS LAST, created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    IF v_promote IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE session_presence
       SET status            = 'confirmed',
           waitlist_position = NULL,
           version           = version + 1,
           updated_at        = now()
     WHERE id = v_promote;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_session_presence_promote_waitlist ON session_presence;
CREATE TRIGGER tg_session_presence_promote_waitlist
    AFTER UPDATE OF status ON session_presence
    FOR EACH ROW
    WHEN (OLD.status = 'confirmed' AND NEW.status <> 'confirmed')
    EXECUTE FUNCTION public.tg_session_presence_promote_waitlist();


-- =====================
-- lt_close_due_session_confirmations (cron)
-- =====================
-- Past a published session's confirmation deadline, flip remaining pending
-- rows to declined (no penalty) and audit one close row per affected session.

CREATE OR REPLACE FUNCTION public.lt_close_due_session_confirmations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_flipped integer;
BEGIN
    WITH due AS (
        SELECT s.id AS session_id, l.organizer_id
          FROM sessions s
          JOIN seasons se ON se.id = s.season_id
          JOIN leagues  l ON l.id = se.league_id
         WHERE s.status = 'published'
           AND s.confirmation_deadline_at IS NOT NULL
           AND s.confirmation_deadline_at <= now()
    ),
    flipped AS (
        UPDATE session_presence sp
           SET status       = 'declined',
               responded_at = COALESCE(sp.responded_at, now()),
               version      = sp.version + 1,
               updated_at   = now()
          FROM due
         WHERE sp.session_id = due.session_id
           AND sp.status     = 'pending'
        RETURNING sp.session_id, due.organizer_id
    ),
    audited AS (
        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        SELECT 'session', f.session_id, 'close_confirmations', f.organizer_id,
               jsonb_build_object('declined_count', count(*))
          FROM flipped f
         GROUP BY f.session_id, f.organizer_id
        RETURNING 1
    )
    SELECT count(*) INTO v_flipped FROM flipped;

    RETURN v_flipped;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_close_due_session_confirmations() FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_close_due_session_confirmations()
    IS 'Cron-invoked: flips pending session_presence to declined once a published session''s confirmation_deadline_at has passed. Spec: specs/17-leagues-tournaments/leagues.md §Confirmations.';

SELECT cron.unschedule('lt-close-session-confirmations') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-close-session-confirmations'
);

SELECT cron.schedule(
  'lt-close-session-confirmations',
  '*/15 * * * *',
  $$ SELECT public.lt_close_due_session_confirmations(); $$
);
