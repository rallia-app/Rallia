-- ============================================================================
-- Migration: "Courts just opened" alert for recurring games
-- Created: 2026-08-28
-- Description: A recurring occurrence is created about a week out, which is
--              beyond most providers' booking horizon (IC3/Otium ~3 days,
--              Tennis Laval ~5 days on the free package). So at creation time
--              there is nothing to book, and the existing court_booking_nudge
--              — whose candidate window is 10 minutes to 2 hours after
--              creation — can never help.
--
--              This sweep watches the gap instead: the first time the snapshot
--              shows an OPEN slot overlapping a recurring game's window, the
--              host gets one push telling them to grab a court now.
--
-- Pieces:
--   1. match.court_open_alert_sent_at — once-ever marker, mirroring
--      booking_nudge_sent_at.
--   2. send_recurring_court_open_alerts() — the sweep, every 15 minutes.
--   3. send_court_booking_nudges() re-defined to skip recurring games, so a
--      host never gets both notifications for the same game.
--   4. recurring_watch_facility_ids() + its own refresh cron. Without this the
--      alert would be late or never fire: the daily pre-warm only covers the
--      top-50 favorited facilities, and the SWR trigger only fires when a user
--      happens to browse. A facility carrying a recurring game has to be polled
--      on its own schedule.
-- ============================================================================

-- =============================================================================
-- 1. Once-ever marker
-- =============================================================================

ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS court_open_alert_sent_at timestamptz;

COMMENT ON COLUMN public.match.court_open_alert_sent_at IS
  'Set when the host was told bookable courts opened for this recurring game. Once ever, per game.';

-- =============================================================================
-- 2. The sweep
-- =============================================================================

CREATE OR REPLACE FUNCTION public.send_recurring_court_open_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      m.id,
      m.created_by,
      m.facility_id,
      m.sport_id,
      f.name  AS facility_name,
      sp.name AS sport_name,
      (m.match_date + m.start_time)
        AT TIME ZONE coalesce(f.timezone, m.timezone, 'UTC') AS match_start,
      (m.match_date + coalesce(m.end_time, m.start_time + interval '90 minutes'))
        AT TIME ZONE coalesce(f.timezone, m.timezone, 'UTC') AS match_end
    FROM public.match m
    JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp   ON sp.id = m.sport_id
    WHERE m.recurrence_id IS NOT NULL
      AND m.court_open_alert_sent_at IS NULL
      AND m.cancelled_at IS NULL
      AND m.location_type = 'facility'
      AND m.facility_id IS NOT NULL
      AND m.court_status IS DISTINCT FROM 'reserved'::public.court_status_enum
      -- Inside the snapshot horizon; anything further out has no data to read.
      AND m.match_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 8
    LIMIT 200
  LOOP
    CONTINUE WHEN r.match_start <= now();

    -- Any OPEN bookable slot overlapping the game window, same sport. Overlap
    -- rather than slot_start equality: player-entered times do not sit on the
    -- provider grid.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM public.facility_availability_snapshot s
      WHERE s.facility_id = r.facility_id
        AND s.sport_id    = r.sport_id
        AND s.is_available
        AND s.slot_start < r.match_end
        AND s.slot_end   > r.match_start
    );

    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.created_by,
      'recurring_court_opened',
      CASE WHEN public.lt_user_is_fr(r.created_by)
        THEN 'Les terrains viennent d''ouvrir à ' || r.facility_name
        ELSE 'Courts just opened at ' || r.facility_name
      END,
      CASE WHEN public.lt_user_is_fr(r.created_by)
        THEN 'Les réservations viennent d''ouvrir pour ta partie récurrente. Réserve ton terrain avant qu''il parte.'
        ELSE 'Booking just opened for your recurring game. Lock in your court before it goes.'
      END,
      jsonb_build_object(
        'matchId',      r.id,
        'facilityName', r.facility_name,
        'sportName',    r.sport_name
      ),
      r.id,
      'high'
    );

    UPDATE public.match SET court_open_alert_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_recurring_court_open_alerts() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_recurring_court_open_alerts() IS
  'Pushes the host of a recurring game once, the first time the availability snapshot shows an open bookable slot overlapping their game window. Run by pg_cron every 15 minutes.';

SELECT cron.unschedule('send-recurring-court-open-alerts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-recurring-court-open-alerts');

SELECT cron.schedule(
  'send-recurring-court-open-alerts',
  '3,18,33,48 * * * *',
  $$ SELECT public.send_recurring_court_open_alerts(); $$
);

-- =============================================================================
-- 3. Keep the two nudges from overlapping
--
-- Body copied verbatim from 20260805130100_court_booking_nudge.sql (the latest
-- definition) with one added predicate: recurring games belong to the sweep
-- above, not to this one.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.send_court_booking_nudges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      m.id,
      m.created_by,
      m.facility_id,
      m.sport_id,
      f.name AS facility_name,
      sp.name AS sport_name,
      (m.match_date + m.start_time)
        AT TIME ZONE coalesce(f.timezone, m.timezone, 'UTC') AS match_start,
      (m.match_date + coalesce(m.end_time, m.start_time + interval '90 minutes'))
        AT TIME ZONE coalesce(f.timezone, m.timezone, 'UTC') AS match_end
    FROM public.match m
    JOIN public.facility f ON f.id = m.facility_id
    JOIN public.sport sp ON sp.id = m.sport_id
    WHERE m.booking_nudge_sent_at IS NULL
      AND m.cancelled_at IS NULL
      AND m.location_type = 'facility'
      AND m.facility_id IS NOT NULL
      AND m.court_status IS DISTINCT FROM 'reserved'::public.court_status_enum
      AND m.recurrence_id IS NULL
      AND m.created_at <= now() - interval '10 minutes'
      AND m.created_at >  now() - interval '2 hours'
    LIMIT 50
  LOOP
    -- Future games only, inside the 7-day snapshot window.
    CONTINUE WHEN r.match_start <= now() OR r.match_start > now() + interval '7 days';

    -- Any open bookable slot overlapping the game window, same sport.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM public.facility_availability_snapshot s
      WHERE s.facility_id = r.facility_id
        AND s.sport_id = r.sport_id
        AND s.is_available
        AND s.slot_start < r.match_end
        AND s.slot_end > r.match_start
    );

    INSERT INTO public.notification (user_id, type, title, body, payload, target_id, priority)
    VALUES (
      r.created_by,
      'court_booking_nudge',
      CASE WHEN public.lt_user_is_fr(r.created_by)
        THEN 'Des terrains sont libres à ' || r.facility_name
        ELSE 'Courts are open at ' || r.facility_name
      END,
      CASE WHEN public.lt_user_is_fr(r.created_by)
        THEN 'Une partie avec terrain réservé attire les joueurs plus vite. Réserve le tien pendant qu''il est libre.'
        ELSE 'Games with a booked court fill faster. Grab yours while it''s open.'
      END,
      jsonb_build_object(
        'matchId', r.id,
        'facilityName', r.facility_name,
        'sportName', r.sport_name
      ),
      r.id,
      'high'
    );

    UPDATE public.match SET booking_nudge_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_court_booking_nudges() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_court_booking_nudges() IS
  'Momentum item 5: nudges hosts of recently created courtless facility matches when bookable snapshot slots overlap their game window. Skips recurring games (send_recurring_court_open_alerts owns those). Run by pg_cron every 5 minutes.';

-- =============================================================================
-- 4. Snapshot coverage for facilities carrying a recurring game
--
-- The alert can only see what the snapshot holds. Neither existing refresh path
-- guarantees coverage: the pre-warm is top-50-favorites only, and the SWR
-- trigger fires on user browsing. A facility hosting an unbooked recurring game
-- inside the snapshot horizon gets polled on its own schedule instead.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recurring_watch_facility_ids(
  p_limit int DEFAULT 50
)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(facility_id), ARRAY[]::uuid[])
  FROM (
    SELECT DISTINCT m.facility_id
    FROM public.match m
    JOIN public.facility f ON f.id = m.facility_id
    LEFT JOIN public.organization o ON o.id = f.organization_id
    WHERE m.recurrence_id IS NOT NULL
      AND m.court_open_alert_sent_at IS NULL
      AND m.cancelled_at IS NULL
      AND m.location_type = 'facility'
      AND m.court_status IS DISTINCT FROM 'reserved'::public.court_status_enum
      AND m.match_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 8
      -- Locals never go through the snapshot.
      AND COALESCE(f.data_provider_id, o.data_provider_id) IS NOT NULL
    LIMIT p_limit
  ) watched;
$$;

GRANT EXECUTE ON FUNCTION public.recurring_watch_facility_ids(int) TO service_role;

COMMENT ON FUNCTION public.recurring_watch_facility_ids IS
  'Facilities carrying an upcoming unbooked recurring game that has not been alerted yet. Drives a dedicated availability refresh so the court-opened alert fires promptly.';

SELECT cron.unschedule('snapshot-refresh-recurring-watch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-refresh-recurring-watch');

-- Every 3 hours. Enough to catch a booking horizon opening within a few hours
-- of it happening, without adding meaningful provider load.
SELECT cron.schedule(
  'snapshot-refresh-recurring-watch',
  '47 */3 * * *',
  $cmd$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'supabase_functions_url'
         LIMIT 1
      ) || '/functions/v1/refresh-facility-availability',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey',       (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := jsonb_build_object(
        'facility_ids', public.recurring_watch_facility_ids(50)
      ),
      timeout_milliseconds := 120000
    )
    WHERE cardinality(public.recurring_watch_facility_ids(50)) > 0;
  $cmd$
);
