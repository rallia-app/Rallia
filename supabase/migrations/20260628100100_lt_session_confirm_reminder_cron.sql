-- ============================================
-- Leagues — confirm-presence reminder (cron)
-- ============================================
-- Once per session, nudge members who still haven't answered, shortly before
-- the cutoff. The cutoff is the confirmation deadline if set, otherwise the
-- scheduled start. Fires when the cutoff is within the next 24h and the session
-- hasn't been reminded yet (confirm_reminder_sent_at), one notification per
-- 'pending' member. Mirrors tg_notify_session_published's payload so the push
-- deep-links to the session's confirm CTA.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_send_session_confirm_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session  record;
    v_rows     jsonb;
    v_sent     integer := 0;
BEGIN
    FOR v_session IN
        SELECT s.id, s.name, s.season_id, s.scheduled_at, s.confirmation_deadline_at,
               s.venue_name, se.league_id, l.name AS league_name
          FROM sessions s
          JOIN seasons se ON se.id = s.season_id
          JOIN leagues  l ON l.id = se.league_id
         WHERE s.status = 'published'
           AND s.confirm_reminder_sent_at IS NULL
           AND COALESCE(s.confirmation_deadline_at, s.scheduled_at) > now()
           AND COALESCE(s.confirmation_deadline_at, s.scheduled_at) <= now() + interval '24 hours'
    LOOP
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
        WHERE sp.session_id = v_session.id
          AND sp.status = 'pending';

        -- Mark as reminded regardless (avoids re-scanning a session with no
        -- pending members every tick).
        UPDATE sessions SET confirm_reminder_sent_at = now() WHERE id = v_session.id;

        IF v_rows IS NOT NULL THEN
            PERFORM insert_notifications(v_rows);
            v_sent := v_sent + jsonb_array_length(v_rows);
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_send_session_confirm_reminders() FROM anon, authenticated;

COMMENT ON FUNCTION public.lt_send_session_confirm_reminders()
    IS 'Cron-invoked: nudges pending session_presence members once, within 24h of the confirmation deadline (or scheduled start if no deadline). Dedup via sessions.confirm_reminder_sent_at.';

SELECT cron.unschedule('lt-session-confirm-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lt-session-confirm-reminders'
);

SELECT cron.schedule(
  'lt-session-confirm-reminders',
  '*/15 * * * *',
  $$ SELECT public.lt_send_session_confirm_reminders(); $$
);
