-- Migration: get_match_fill_analytics RPC
-- Tracks match creation vs fill (all slots taken) per day, per sport.
-- "Filled" = joined participant count >= format capacity (singles=2, doubles=4).

CREATE OR REPLACE FUNCTION get_match_fill_analytics(
  p_start_date date,
  p_end_date   date
) RETURNS TABLE (
  date             date,
  sport_id         uuid,
  sport_name       text,
  matches_created  bigint,
  matches_filled   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH participant_counts AS (
    SELECT
      mp.match_id,
      COUNT(*) FILTER (WHERE mp.status = 'joined') AS joined_count
    FROM match_participant mp
    INNER JOIN match m ON m.id = mp.match_id
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY mp.match_id
  ),
  match_fill AS (
    SELECT
      m.id            AS match_id,
      m.created_at::date AS match_date,
      m.sport_id,
      s.display_name::text AS sport_name,
      CASE
        WHEN COALESCE(pc.joined_count, 0) >= CASE m.format
          WHEN 'doubles' THEN 4
          ELSE 2
        END THEN 1
        ELSE 0
      END AS is_filled
    FROM match m
    INNER JOIN sport s ON s.id = m.sport_id
    LEFT JOIN participant_counts pc ON pc.match_id = m.id
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
      AND m.cancelled_at IS NULL
  )
  SELECT
    mf.match_date        AS date,
    mf.sport_id,
    mf.sport_name,
    COUNT(*)             AS matches_created,
    SUM(mf.is_filled)   AS matches_filled
  FROM match_fill mf
  GROUP BY mf.match_date, mf.sport_id, mf.sport_name
  ORDER BY mf.match_date, mf.sport_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_match_fill_analytics(date, date) TO authenticated;

COMMENT ON FUNCTION get_match_fill_analytics IS
  'Returns daily match creation vs fill counts per sport. A match is filled when joined participants >= format capacity (2 for singles, 4 for doubles). Excludes cancelled matches.';
