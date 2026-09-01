-- =============================================================================
-- Pending invite reminder: one nudge before the game starts
--
-- A player who is invited to a game receives exactly ONE notification, ever.
-- Verified in production: across August, pending invitees received 755
-- match_invitation pushes and 1 match_updated between them. Nothing else.
--
-- That single push has to survive the whole window, and the window is short.
-- For August invites on live games:
--   - median lead time from invite to start is 16.5 hours, average 24.2
--   - 216 of 798 (27%) have under 6 hours of lead
--   - invites expire when the game starts (expire_stale_match_invites)
--   - 649 of 1,057 invites (61%) were never answered at all
--
-- The people who do answer, answer fast: median 36 minutes from invite to
-- response. So this is a delivery-timing problem, not disinterest. The invite
-- is already 'high' priority, and it is still read on average 2.3 days after
-- sending, long after the game has come and gone.
--
-- Fix: one reminder to invitees still pending when the game is 2-6 hours out,
-- mirroring the window send_last_minute_spot_pushes already uses. 44 invitees
-- already respond inside that window unprompted, which is evidence it is when
-- the decision actually gets made.
--
-- Sizing (read-only replay on August): 363 invites would reach the window still
-- pending, about 90 reminders per week.
--
-- Type reuse: this sends another 'match_invitation' rather than a new enum
-- value, deliberately. It inherits the working push template, deep link and the
-- clear_stale_match_invitation_notification trigger (20260625130000), which
-- removes BOTH rows the moment the invite resolves. A new type would need
-- template, i18n and mobile routing work to reach the same place, with a real
-- risk of a push that navigates nowhere. payload.isReminder distinguishes them
-- and carries the dedup.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.send_pending_invite_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH due AS (
    SELECT
      mp.player_id,
      mp.match_id,
      mt.start_time,
      sp.name AS sport_name,
      COALESCE(f.name, NULLIF(TRIM(mt.location_name), '')) AS location_name,
      COALESCE(
        NULLIF(TRIM(pr.first_name), ''),
        NULLIF(TRIM(pr.display_name), '')
      ) AS host_name
    FROM match_participant mp
    JOIN match mt ON mt.id = mp.match_id
    JOIN sport sp ON sp.id = mt.sport_id
    LEFT JOIN facility f ON f.id = mt.facility_id
    LEFT JOIN profile pr ON pr.id = mt.created_by
    WHERE mp.status = 'pending'
      AND mp.is_host = false
      AND mp.requested_at IS NULL
      AND mp.expired_at IS NULL
      AND mt.cancelled_at IS NULL
      AND COALESCE(mt.is_auto_generated, false) = false
      -- Same 2-6 hour window as the last-minute lane.
      AND ((mt.match_date + COALESCE(mt.start_time, '23:59'::time))
             AT TIME ZONE COALESCE(f.timezone, mt.timezone, 'America/Toronto'))
          BETWEEN now() + interval '2 hours' AND now() + interval '6 hours'
      -- Never remind straight after the host invited them.
      AND mp.created_at < now() - interval '1 hour'
      -- One reminder ever per (match, player), independent of whether the
      -- original invite push exists: 302 of August's invites never got one.
      AND NOT EXISTS (
        SELECT 1 FROM notification n
        WHERE n.type      = 'match_invitation'
          AND n.target_id = mp.match_id
          AND n.user_id   = mp.player_id
          AND n.payload->>'isReminder' = 'true'
      )
  )
  INSERT INTO notification (user_id, type, title, body, payload, target_id, priority)
  SELECT
    due.player_id,
    'match_invitation',
    CASE WHEN public.lt_user_is_fr(due.player_id)
      THEN COALESCE(due.host_name || ' attend ta réponse', 'Ton invitation expire bientôt')
      ELSE COALESCE(due.host_name || ' is waiting on your answer', 'Your invite expires soon')
    END,
    CASE WHEN public.lt_user_is_fr(due.player_id)
      THEN COALESCE(due.sport_name, 'Partie')
        || ' aujourd''hui à ' || to_char(due.start_time, 'HH24:MI')
        || COALESCE(' au ' || due.location_name, '')
        || '. Réponds avant que ça commence.'
      ELSE COALESCE(due.sport_name, 'Game')
        || ' today at ' || to_char(due.start_time, 'FMHH12:MI AM')
        || COALESCE(' at ' || due.location_name, '')
        || '. Let them know before it starts.'
    END,
    jsonb_build_object(
      'matchId',      due.match_id,
      'playerName',   due.host_name,
      'sportName',    COALESCE(due.sport_name, ''),
      'startTime',    to_char(due.start_time, 'HH24:MI'),
      'locationName', due.location_name,
      'isReminder',   true
    ),
    due.match_id,
    'high'
  FROM due;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.send_pending_invite_reminders() IS
  'One reminder per invited player whose invite is still pending 2-6 hours before the game. Sends a second match_invitation flagged payload.isReminder so it reuses the existing template, deep link and cleanup trigger.';

SELECT cron.schedule(
  'send-pending-invite-reminders',
  '12,27,42,57 * * * *',
  $$ SELECT public.send_pending_invite_reminders(); $$
);
