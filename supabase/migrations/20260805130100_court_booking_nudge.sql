-- ============================================================================
-- Migration: Court booking nudge sweep
-- Created: 2026-08-05
-- Description: A few minutes after a player creates a facility match without
--              a booked court, nudge them by push when the facility still has
--              open, online-bookable slots overlapping their game window
--              ("you're more likely to attract players with a booked court").
--              Momentum harvesting item 5.
--
-- Mechanics:
--   - match.booking_nudge_sent_at marks a match as nudged (once, ever).
--   - send_court_booking_nudges() sweeps recently created candidates and
--     inserts one court_booking_nudge notification for the host. Delivery
--     happens via the existing on_notification_insert -> send-notification
--     pipeline; tapping deep-links to the match detail sheet, which already
--     renders bookable slots (MatchAvailableCourtsSection).
--   - pg_cron runs the sweep every 5 minutes. The candidate window is
--     created_at in [now()-2h, now()-10min], so a match is nudged 10-15
--     minutes after creation in steady state, and the sweep self-heals after
--     short cron outages without unbounded backfill.
--   - Bookability = an is_available snapshot slot for the match's sport that
--     OVERLAPS the game window (not exact slot_start equality: player-entered
--     times don't always sit on the provider grid).
-- ============================================================================

-- 1. Once-ever marker
ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS booking_nudge_sent_at timestamptz;

-- 2. Sweep function
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
  'Momentum item 5: nudges hosts of recently created courtless facility matches when bookable snapshot slots overlap their game window. Run by pg_cron every 5 minutes.';

-- 3. Cron
SELECT cron.unschedule('send-court-booking-nudges')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-court-booking-nudges');

SELECT cron.schedule(
  'send-court-booking-nudges',
  '*/5 * * * *',
  $$ SELECT public.send_court_booking_nudges(); $$
);
