-- =============================================================================
-- CHECK-IN REMINDER NOTIFICATION SYSTEM
-- Sends notifications to joined participants ~10 minutes before match start,
-- telling them check-in is now available.
-- Triggered by pg_cron via the send-check-in-reminders Edge Function.
-- =============================================================================

-- =============================================================================
-- PART 1: ADD NOTIFICATION TYPE ENUM VALUE
-- =============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'match_check_in_available';

-- =============================================================================
-- PART 2: ADD TRACKING COLUMN TO MATCH_PARTICIPANT
-- =============================================================================

ALTER TABLE match_participant
  ADD COLUMN IF NOT EXISTS match_check_in_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN match_participant.match_check_in_reminder_sent_at IS
  'When the check-in reminder notification was sent (~10 minutes before match start)';

-- Index for efficient querying of participants needing check-in reminders
CREATE INDEX IF NOT EXISTS idx_match_participant_check_in_reminder
  ON match_participant(match_check_in_reminder_sent_at)
  WHERE status = 'joined';

-- =============================================================================
-- PART 3: RPC FUNCTION - GET PARTICIPANTS FOR CHECK-IN REMINDER
-- =============================================================================

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
    f.name::TEXT AS location_name
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mp.status = 'joined'
    AND mp.match_check_in_reminder_sent_at IS NULL
    AND m.cancelled_at IS NULL
    -- Only matches that have enough players (actually happening)
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    -- Match start time falls within the notification window
    AND (m.match_date + m.start_time) AT TIME ZONE m.timezone
      BETWEEN p_window_start AND p_window_end;
END;
$$;

COMMENT ON FUNCTION get_participants_for_check_in_reminder IS
  'Returns joined participants whose matches start within the specified time window and have not yet received the check-in reminder notification';

-- =============================================================================
-- PART 4: RPC FUNCTION - MARK CHECK-IN REMINDERS AS SENT
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_check_in_reminder_sent(
  p_participant_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE match_participant
  SET match_check_in_reminder_sent_at = NOW()
  WHERE id = ANY(p_participant_ids)
    AND match_check_in_reminder_sent_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION mark_check_in_reminder_sent IS
  'Marks participants as having received the check-in reminder notification';

-- =============================================================================
-- PART 5: VERIFICATION
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'match_participant'
    AND column_name = 'match_check_in_reminder_sent_at'
  ) THEN
    RAISE EXCEPTION 'match_check_in_reminder_sent_at column was not created';
  END IF;

  RAISE NOTICE 'Check-in reminder notification system migration completed successfully';
END $$;
