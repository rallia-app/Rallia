-- =============================================================================
-- FIX: Feedback reminder timezone + only played matches + correct time windows
--
-- 1. Use AT TIME ZONE m.timezone instead of ::TIMESTAMPTZ cast to correctly
--    convert local match time to UTC.
--
-- 2. Only send notifications for matches that were actually played (full).
--
-- 3. Windows: initial = 1–2h ago, reminder = 24–25h ago (with buffer).
--    Deduplication is still handled by tracking columns.
--
-- 4. Notify if feedback is incomplete OR score is not settled for the player.
--    "Score not settled" = no match_result exists, OR one exists but the player
--    neither submitted it nor responded via score_confirmation.
-- =============================================================================

-- Drop old signatures and recreate
DROP FUNCTION IF EXISTS get_participants_for_initial_feedback_notification(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS get_participants_for_feedback_reminder(TIMESTAMPTZ, TIMESTAMPTZ);

-- Initial feedback notification: games that ended between p_cutoff_start and p_cutoff_end
CREATE OR REPLACE FUNCTION get_participants_for_initial_feedback_notification(
  p_cutoff_start TIMESTAMPTZ,
  p_cutoff_end TIMESTAMPTZ
)
RETURNS TABLE (
  participant_id UUID,
  player_id UUID,
  match_id UUID,
  match_date DATE,
  start_time TIME,
  end_time TIME,
  sport_name TEXT,
  format TEXT,
  timezone TEXT
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
    m.end_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  WHERE mp.status = 'joined'
    AND mp.initial_feedback_notification_sent_at IS NULL
    AND m.cancelled_at IS NULL
    AND m.closed_at IS NULL
    -- Only matches that were full (actually played)
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    AND (m.match_date + m.end_time) AT TIME ZONE m.timezone
      BETWEEN p_cutoff_start AND p_cutoff_end
    -- At least one of: feedback incomplete OR score not settled for this player
    AND (
      mp.feedback_completed = false
      OR NOT EXISTS (
        -- Player has settled the score if they submitted it or responded to it
        SELECT 1 FROM match_result mr
        WHERE mr.match_id = m.id
          AND (
            mr.submitted_by = mp.player_id
            OR EXISTS (
              SELECT 1 FROM score_confirmation sc
              WHERE sc.match_result_id = mr.id
                AND sc.player_id = mp.player_id
            )
          )
      )
    );
END;
$$;

-- Feedback reminder: games that ended between p_cutoff_start and p_cutoff_end
CREATE OR REPLACE FUNCTION get_participants_for_feedback_reminder(
  p_cutoff_start TIMESTAMPTZ,
  p_cutoff_end TIMESTAMPTZ
)
RETURNS TABLE (
  participant_id UUID,
  player_id UUID,
  match_id UUID,
  match_date DATE,
  start_time TIME,
  end_time TIME,
  sport_name TEXT,
  format TEXT,
  timezone TEXT
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
    m.end_time,
    s.name::TEXT AS sport_name,
    m.format::TEXT,
    m.timezone::TEXT
  FROM match_participant mp
  INNER JOIN match m ON m.id = mp.match_id
  INNER JOIN sport s ON s.id = m.sport_id
  WHERE mp.status = 'joined'
    AND mp.feedback_reminder_sent_at IS NULL
    AND mp.initial_feedback_notification_sent_at IS NOT NULL
    AND m.cancelled_at IS NULL
    AND m.closed_at IS NULL
    -- Only matches that were full (actually played)
    AND (SELECT COUNT(*) FROM match_participant mp2
         WHERE mp2.match_id = m.id AND mp2.status = 'joined')
        >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    AND (m.match_date + m.end_time) AT TIME ZONE m.timezone
      BETWEEN p_cutoff_start AND p_cutoff_end
    -- At least one of: feedback incomplete OR score not settled for this player
    AND (
      mp.feedback_completed = false
      OR NOT EXISTS (
        SELECT 1 FROM match_result mr
        WHERE mr.match_id = m.id
          AND (
            mr.submitted_by = mp.player_id
            OR EXISTS (
              SELECT 1 FROM score_confirmation sc
              WHERE sc.match_result_id = mr.id
                AND sc.player_id = mp.player_id
            )
          )
      )
    );
END;
$$;
