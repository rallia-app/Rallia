-- Fix: notification RPCs should fall back to match.location_name
-- when facility is NULL (custom-location matches).

-- Fix get_participants_for_match_starting_soon
CREATE OR REPLACE FUNCTION get_participants_for_match_starting_soon(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE (
  participant_id UUID,
  player_id UUID,
  match_id UUID,
  match_date DATE,
  start_time TIME,
  sport_name TEXT,
  format TEXT,
  timezone TEXT,
  location_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mp.id AS participant_id,
    mp.player_id,
    m.id AS match_id,
    m.match_date,
    m.start_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT,
    COALESCE(f.name, m.location_name)::TEXT AS location_name
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mp.status = 'joined'
    AND mp.match_starting_soon_sent_at IS NULL
    AND m.cancelled_at IS NULL
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    AND (m.match_date + m.start_time) AT TIME ZONE m.timezone
      BETWEEN p_window_start AND p_window_end;
END;
$$;

-- Fix get_participants_for_check_in_reminder
CREATE OR REPLACE FUNCTION get_participants_for_check_in_reminder(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE (
  participant_id UUID,
  player_id UUID,
  match_id UUID,
  match_date DATE,
  start_time TIME,
  sport_name TEXT,
  format TEXT,
  timezone TEXT,
  location_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mp.id AS participant_id,
    mp.player_id,
    m.id AS match_id,
    m.match_date,
    m.start_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT,
    COALESCE(f.name, m.location_name)::TEXT AS location_name
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mp.status = 'joined'
    AND mp.match_check_in_reminder_sent_at IS NULL
    AND m.cancelled_at IS NULL
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    AND (m.match_date + m.start_time) AT TIME ZONE m.timezone
      BETWEEN p_window_start AND p_window_end;
END;
$$;
