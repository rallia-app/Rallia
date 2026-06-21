-- =============================================================================
-- Casual games: feedback-only post-game flow
--
-- Casual matches (match.player_expectation = 'casual') no longer ask players to
-- submit a score after the game — they are only asked for match feedback.
--
-- 1. Both feedback-notification RPCs now return m.player_expectation so the
--    send-feedback-reminders edge function can pick feedback-only copy for
--    casual games (vs the combined "score + rating" copy for competitive/both).
--
-- 2. Casual games are only eligible for a notification when feedback is still
--    incomplete. The "score not settled" branch that also triggered the
--    reminder is restricted to non-casual games, so a casual player who has
--    given feedback is never nagged about a score we don't collect.
-- =============================================================================

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
  timezone TEXT,
  player_expectation TEXT
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
    m.timezone::TEXT,
    m.player_expectation::TEXT
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
    -- Feedback incomplete OR (non-casual game AND score not settled for this player).
    -- Casual games never collect a score, so the score-settlement branch is skipped.
    AND (
      mp.feedback_completed = false
      OR (
        m.player_expectation <> 'casual'
        AND NOT EXISTS (
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
  timezone TEXT,
  player_expectation TEXT
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
    m.timezone::TEXT,
    m.player_expectation::TEXT
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
    -- Feedback incomplete OR (non-casual game AND score not settled for this player).
    -- Casual games never collect a score, so the score-settlement branch is skipped.
    AND (
      mp.feedback_completed = false
      OR (
        m.player_expectation <> 'casual'
        AND NOT EXISTS (
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
      )
    );
END;
$$;
