-- =============================================================================
-- MATCH STARTING SOON NOTIFICATION SYSTEM
-- Sends notifications to joined participants ~2 hours before match start.
-- Triggered every 5 minutes by pg_cron via the send-match-reminders Edge Function.
-- =============================================================================

-- =============================================================================
-- PART 1: ADD TRACKING COLUMN TO MATCH_PARTICIPANT
-- =============================================================================

ALTER TABLE match_participant
  ADD COLUMN IF NOT EXISTS match_starting_soon_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN match_participant.match_starting_soon_sent_at IS
  'When the match-starting-soon notification was sent (~2 hours before match start)';

-- Index for efficient querying of participants needing notifications
CREATE INDEX IF NOT EXISTS idx_match_participant_starting_soon
  ON match_participant(match_starting_soon_sent_at)
  WHERE status = 'joined';

-- =============================================================================
-- PART 2: RPC FUNCTION - GET PARTICIPANTS FOR MATCH STARTING SOON
-- =============================================================================

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
    f.name::TEXT AS location_name
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mp.status = 'joined'
    AND mp.match_starting_soon_sent_at IS NULL
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

COMMENT ON FUNCTION get_participants_for_match_starting_soon IS
  'Returns joined participants whose matches start within the specified time window and have not yet received the match-starting-soon notification';

-- =============================================================================
-- PART 3: RPC FUNCTION - MARK NOTIFICATIONS AS SENT
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_match_starting_soon_sent(
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
  SET match_starting_soon_sent_at = NOW()
  WHERE id = ANY(p_participant_ids)
    AND match_starting_soon_sent_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION mark_match_starting_soon_sent IS
  'Marks participants as having received the match-starting-soon notification';

-- =============================================================================
-- PART 4: VERIFICATION
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'match_participant'
    AND column_name = 'match_starting_soon_sent_at'
  ) THEN
    RAISE EXCEPTION 'match_starting_soon_sent_at column was not created';
  END IF;

  RAISE NOTICE 'Match starting soon notification system migration completed successfully';
END $$;
