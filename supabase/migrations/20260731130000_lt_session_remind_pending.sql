-- ============================================================================
-- Leagues — the organizer can chase the members who have not answered
-- ============================================================================
-- The only nudge that existed was the cron lt_send_session_confirm_reminders,
-- which fires once per session and only inside the last 24 hours before the
-- confirmation deadline. An organizer looking at three unanswered members a
-- week out had nothing to press. Reported as "j'aimerais pouvoir relancer les
-- joueurs qui n'ont pas repondu".
--
-- session_remind_pending sends the same notification the cron sends, to the
-- same audience (presence still 'pending'), on demand:
--
--   * organizer or admin only, on a published session that has not passed
--   * rate limited to one manual nudge per session per 6 hours, so a frustrated
--     organizer cannot turn it into a push loop. The limit reads the audit
--     trail rather than a new column, and admins are held to it too: the point
--     is protecting the recipients, not gating the caller.
--   * NO_PENDING_MEMBERS when everyone has already answered, so the client can
--     say so instead of reporting a silent success
--
-- It deliberately does NOT touch confirm_reminder_sent_at: the automatic
-- deadline reminder is a different promise to the player and still owes them
-- its run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.session_remind_pending(
    p_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_cooldown constant interval := interval '6 hours';
    v_caller   uuid := auth.uid();
    v_session  record;
    v_rows     jsonb;
    v_count    integer;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT s.id, s.name, s.status, s.season_id, s.scheduled_at,
           s.confirmation_deadline_at, s.venue_name,
           se.league_id, l.name AS league_name
      INTO v_session
      FROM sessions s
      JOIN seasons se ON se.id = s.season_id
      JOIN leagues  l ON l.id = se.league_id
     WHERE s.id = p_session_id;

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_session.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_session.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_NOT_PUBLISHED';
    END IF;

    -- Nothing to confirm once the session has been played.
    IF v_session.scheduled_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SESSION_PAST';
    END IF;

    IF EXISTS (
        SELECT 1 FROM leagues_tournaments_audit
         WHERE scope = 'session'
           AND entity_id = p_session_id
           AND action = 'remind_pending'
           AND occurred_at > now() - c_cooldown
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REMINDER_TOO_SOON';
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'user_id', sp.user_id,
        'type', 'session_confirm_reminder',
        'target_id', v_session.id,
        'title', CASE WHEN public.lt_user_is_fr(sp.user_id)
                   THEN 'Confirme ta présence' ELSE 'Confirm your spot' END,
        'body', CASE WHEN public.lt_user_is_fr(sp.user_id)
                  THEN coalesce(v_session.league_name, 'Ta ligue') || ' : réponds pour '
                       || v_session.name || ' avant que ta place soit donnée.'
                  ELSE coalesce(v_session.league_name, 'Your league') || ': respond for '
                       || v_session.name || ' before your spot is released.'
                END,
        'payload', jsonb_build_object(
            'entityKind', 'session',
            'leagueId', v_session.league_id,
            'seasonId', v_session.season_id,
            'sessionId', v_session.id,
            'sessionName', v_session.name,
            'scheduledAt', v_session.scheduled_at,
            'confirmationDeadlineAt', v_session.confirmation_deadline_at,
            'venueName', v_session.venue_name
        ),
        'priority', 'normal'
    ))
      INTO v_rows
      FROM session_presence sp
     WHERE sp.session_id = p_session_id
       AND sp.status = 'pending'
       AND sp.user_id <> v_caller;

    IF v_rows IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_PENDING_MEMBERS';
    END IF;

    v_count := jsonb_array_length(v_rows);
    PERFORM insert_notifications(v_rows);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('session', p_session_id, 'remind_pending', v_caller,
            jsonb_build_object('recipients', v_count));

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.session_remind_pending(uuid) IS
'Organizer-triggered confirmation nudge for a published future session. Sends
the cron''s session_confirm_reminder notification to every member still
pending, at most once per session per 6 hours. Raises NO_PENDING_MEMBERS when
everyone has answered and REMINDER_TOO_SOON inside the cooldown.';

REVOKE ALL ON FUNCTION public.session_remind_pending(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.session_remind_pending(uuid) TO authenticated;
