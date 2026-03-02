-- Migration: Add 'private' filter to get_player_matches RPC
-- Description: Adds a 'private' status filter that returns only matches
--              with visibility = 'private'.

CREATE OR REPLACE FUNCTION get_player_matches(
  p_player_id UUID,
  p_time_filter TEXT DEFAULT 'upcoming', -- 'upcoming' or 'past'
  p_sport_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_status_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  match_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_time_utc TIMESTAMPTZ := NOW();
  forty_eight_hours_ago TIMESTAMPTZ := NOW() - INTERVAL '48 hours';
BEGIN
  RETURN QUERY
  SELECT m.id AS match_id
  FROM match m
  LEFT JOIN match_participant mp ON mp.match_id = m.id AND mp.player_id = p_player_id
  WHERE
    (
      m.created_by = p_player_id
      OR mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
    )
    AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND (
      CASE
        WHEN p_status_filter = 'cancelled' THEN m.cancelled_at IS NOT NULL
        ELSE m.cancelled_at IS NULL
      END
    )
    AND (
      CASE p_status_filter
        WHEN 'all' THEN TRUE
        WHEN 'hosting' THEN
          m.created_by = p_player_id
        WHEN 'confirmed' THEN
          mp.status = 'joined'
        WHEN 'waiting' THEN
          mp.status IN ('pending', 'requested', 'waitlisted')
        WHEN 'pending' THEN
          mp.status = 'pending'
        WHEN 'requested' THEN
          mp.status = 'requested'
        WHEN 'waitlisted' THEN
          mp.status = 'waitlisted'
        WHEN 'needs_players' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'feedback_needed' THEN
          mp.status = 'joined'
          AND mp.feedback_completed = false
          AND (SELECT COUNT(*) FROM match_participant mp2
               WHERE mp2.match_id = m.id AND mp2.status = 'joined')
              >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          AND (
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= forty_eight_hours_ago
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= forty_eight_hours_ago
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
        WHEN 'completed' THEN
          EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
        WHEN 'played' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'hosted' THEN
          m.created_by = p_player_id
        WHEN 'unfilled' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'expired' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'cancelled' THEN
          TRUE
        WHEN 'private' THEN
          m.visibility = 'private'
        ELSE TRUE
      END
    )
    AND (
      CASE
        WHEN p_time_filter = 'upcoming' THEN
          NOT EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          AND (
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
          AND (
            -- Still scheduled (start_time in future) OR match is full (in progress, not expired)
            (CASE
              WHEN m.timezone IS NOT NULL THEN
                timezone(m.timezone, (m.match_date + m.start_time)::timestamp) >= current_time_utc
              ELSE
                (m.match_date + m.start_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
            END)
            OR
            (SELECT COUNT(*) FROM match_participant mp2
             WHERE mp2.match_id = m.id AND mp2.status = 'joined')
            >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          )
        WHEN p_time_filter = 'past' THEN
          (m.created_by = p_player_id OR mp.status = 'joined')
          AND (
          EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          OR (
            -- Match end_time has passed (normal past match)
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) < current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) < current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
          OR (
            -- Expired match: start_time has passed but match was not full
            (CASE
              WHEN m.timezone IS NOT NULL THEN
                timezone(m.timezone, (m.match_date + m.start_time)::timestamp) < current_time_utc
              ELSE
                (m.match_date + m.start_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
            END)
            AND (SELECT COUNT(*) FROM match_participant mp2
                 WHERE mp2.match_id = m.id AND mp2.status = 'joined')
                < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          )
          )
        ELSE
          FALSE
      END
    )
  ORDER BY
    CASE WHEN p_time_filter = 'upcoming' THEN (m.match_date + m.start_time)::timestamp END ASC,
    CASE WHEN p_time_filter = 'past' THEN (m.match_date + m.start_time)::timestamp END DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION get_player_matches(UUID, TEXT, UUID, INT, INT, TEXT) IS 'Get matches for a player with optional status filtering. Upcoming excludes expired matches (start passed, not full). Past includes expired matches as soon as start_time passes. Supports filters: all, hosting, confirmed, waiting, needs_players, private (upcoming), feedback_needed, completed, hosted, unfilled, cancelled, private (past). Legacy filters pending, requested, waitlisted, played, expired still work.';
