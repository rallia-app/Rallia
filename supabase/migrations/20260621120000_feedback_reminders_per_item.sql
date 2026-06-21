-- =============================================================================
-- Post-game reminders: nudge only about what's still outstanding
--
-- A player only ever owes two things after a game: a score (competitive/both
-- games only) and feedback. Until now the reminder fired while EITHER was
-- pending but always used the combined "submit your score and rate" copy — so a
-- player who had already rated everyone (but not submitted the score, or vice
-- versa) was told to redo the part they'd already done.
--
-- Both feedback RPCs now surface two per-player booleans so the
-- send-feedback-reminders edge function can pick score-only / feedback-only /
-- both copy:
--   * needs_feedback : this participant hasn't completed their feedback
--   * needs_score    : competitive/both game AND this participant hasn't
--                      submitted or confirmed the score (always false for casual)
--
-- The recipient filter is unchanged: a row is still returned only when at least
-- one of the two is outstanding (needs_feedback OR needs_score).
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
  player_expectation TEXT,
  needs_feedback BOOLEAN,
  needs_score BOOLEAN
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
    m.player_expectation::TEXT,
    (mp.feedback_completed = false) AS needs_feedback,
    (
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
    ) AS needs_score
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
  player_expectation TEXT,
  needs_feedback BOOLEAN,
  needs_score BOOLEAN
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
    m.player_expectation::TEXT,
    (mp.feedback_completed = false) AS needs_feedback,
    (
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
    ) AS needs_score
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
