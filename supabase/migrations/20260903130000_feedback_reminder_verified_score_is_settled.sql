-- ============================================================================
-- A declared score settles the game for everyone, not just the declarer.
-- ============================================================================
-- 20260831160000 made a declared score final on entry: the row is written
-- verified and the opponent's only move is to contest it. The two post-game
-- feedback RPCs never learned that. Their needs_score still read "this player
-- neither submitted nor confirmed", which under one-way registration is true
-- of every opponent forever, so 24 h after a game with a perfectly final score
-- the opponent got "Un score à soumettre" and was sent to the score wizard.
-- Reported by a Série 2 player on 2026-09-03.
--
-- A verified result now counts as settled for every participant. The legacy
-- reading is kept for unverified rows, which still exist from older clients
-- and from the direct-insert path, so a real pending confirmation still nudges.
--
-- Bodies copied from 20260621120000 and verified against the live definition.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_participants_for_initial_feedback_notification(
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
        -- Settled when the score stands (one-way), or, on a legacy unverified
        -- row, when this player submitted it or responded to it.
        SELECT 1 FROM match_result mr
        WHERE mr.match_id = m.id
          AND (
            mr.is_verified
            OR mr.submitted_by = mp.player_id
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
    AND (
      mp.feedback_completed = false
      OR (
        m.player_expectation <> 'casual'
        AND NOT EXISTS (
          SELECT 1 FROM match_result mr
          WHERE mr.match_id = m.id
            AND (
              mr.is_verified
              OR mr.submitted_by = mp.player_id
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

CREATE OR REPLACE FUNCTION public.get_participants_for_feedback_reminder(
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
        -- Settled when the score stands (one-way), or, on a legacy unverified
        -- row, when this player submitted it or responded to it.
        SELECT 1 FROM match_result mr
        WHERE mr.match_id = m.id
          AND (
            mr.is_verified
            OR mr.submitted_by = mp.player_id
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
    AND (
      mp.feedback_completed = false
      OR (
        m.player_expectation <> 'casual'
        AND NOT EXISTS (
          SELECT 1 FROM match_result mr
          WHERE mr.match_id = m.id
            AND (
              mr.is_verified
              OR mr.submitted_by = mp.player_id
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
