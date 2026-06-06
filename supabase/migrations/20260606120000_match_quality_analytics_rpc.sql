-- Migration: get_match_quality_analytics RPC
-- Reframes match analytics around the "completed quality game" concept, judged at
-- closure (~48h after match end, via the close-matches edge function). Returns the
-- full lifecycle funnel per day, per sport, bucketed by match_date (play date):
--   created -> filled -> played (>=2 present) -> quality (strict bar).
--
-- A match is a STRICT quality game when, at closure, it clears ALL gates:
--   * played          : >= 2 joined participants confirmed present (showed_up = true)
--   * full attendance : no joined participant a no-show or unconfirmed
--   * punctual        : no joined participant was late
--   * well-rated      : avg aggregated star_rating >= 4 (over rated participants)
--   * clean           : zero match_report rows
-- Because the gates require positive confirmation, matches with no submitted
-- feedback fail strict -> the quality count is an honest floor. Feedback coverage
-- (feedback_present / feedback_expected) is returned so the UI can show confidence.

CREATE OR REPLACE FUNCTION get_match_quality_analytics(
  p_start_date date,
  p_end_date   date
) RETURNS TABLE (
  date                  date,
  sport_id              uuid,
  sport_name            text,
  is_auto_generated     boolean,
  -- Funnel
  matches_created       bigint,
  matches_filled        bigint,
  matches_played        bigint,
  matches_quality       bigint,
  -- Drop-off branches
  matches_cancelled     bigint,
  matches_mutual_cancel bigint,
  matches_fell_through  bigint,
  matches_pending       bigint,
  -- Why played matches missed the quality bar (overlapping diagnostics)
  played_no_show        bigint,
  played_late           bigint,
  played_low_rating     bigint,
  played_reported       bigint,
  -- Avg rating (client computes rating_sum / rating_count)
  rating_sum            bigint,
  rating_count          bigint,
  -- Feedback coverage / confidence (over resolved, played-eligible matches)
  feedback_expected     bigint,
  feedback_present       bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH joined AS (
    SELECT
      mp.match_id,
      COUNT(*)                                                       AS joined_count,
      COUNT(*) FILTER (WHERE mp.showed_up IS TRUE)                   AS present_count,
      COUNT(*) FILTER (WHERE mp.showed_up IS FALSE)                  AS noshow_count,
      COUNT(*) FILTER (WHERE mp.showed_up IS NULL)                   AS unknown_count,
      COUNT(*) FILTER (WHERE mp.was_late IS TRUE)                    AS late_count,
      COUNT(*) FILTER (WHERE mp.showed_up IS NOT NULL)               AS feedback_count,
      COUNT(*) FILTER (WHERE mp.star_rating IS NOT NULL)             AS rating_count,
      COALESCE(SUM(mp.star_rating) FILTER (WHERE mp.star_rating IS NOT NULL), 0) AS rating_sum,
      AVG(mp.star_rating) FILTER (WHERE mp.star_rating IS NOT NULL)  AS avg_rating
    FROM match_participant mp
    INNER JOIN match m ON m.id = mp.match_id
    WHERE m.match_date BETWEEN p_start_date AND p_end_date
      AND mp.status = 'joined'
    GROUP BY mp.match_id
  ),
  reports AS (
    SELECT mr.match_id, COUNT(*) AS report_count
    FROM match_report mr
    INNER JOIN match m ON m.id = mr.match_id
    WHERE m.match_date BETWEEN p_start_date AND p_end_date
    GROUP BY mr.match_id
  ),
  per_match AS (
    SELECT
      m.match_date                                  AS date,
      m.sport_id,
      s.display_name::text                          AS sport_name,
      COALESCE(m.is_auto_generated, false)          AS is_auto_generated,
      COALESCE(j.joined_count, 0)                   AS jc,
      COALESCE(j.present_count, 0)                  AS pc,
      COALESCE(j.noshow_count, 0)                   AS nsc,
      COALESCE(j.unknown_count, 0)                  AS unk,
      COALESCE(j.late_count, 0)                     AS lc,
      COALESCE(j.feedback_count, 0)                 AS fbc,
      COALESCE(j.rating_count, 0)                   AS rc,
      COALESCE(j.rating_sum, 0)                     AS rs,
      j.avg_rating,
      COALESCE(r.report_count, 0)                   AS rep,
      (m.cancelled_at IS NOT NULL)                  AS is_cancelled,
      (m.closed_at IS NOT NULL)                     AS is_closed,
      (m.mutually_cancelled IS TRUE)                AS is_mutual,
      COALESCE(j.joined_count, 0) >= CASE m.format WHEN 'doubles' THEN 4 ELSE 2 END AS is_filled
    FROM match m
    INNER JOIN sport s ON s.id = m.sport_id
    LEFT JOIN joined j  ON j.match_id = m.id
    LEFT JOIN reports r ON r.match_id = m.id
    WHERE m.match_date BETWEEN p_start_date AND p_end_date
  ),
  flagged AS (
    SELECT
      pm.*,
      -- Single, mutually-exclusive lifecycle outcome (precedence top-to-bottom),
      -- so the buckets partition `created` exactly. Mutual-cancel takes precedence
      -- over generic cancel because it is the more specific drop-off reason (in
      -- practice a mutual-cancel match also carries cancelled_at).
      CASE
        WHEN pm.is_mutual                       THEN 'mutual'
        WHEN pm.is_cancelled                    THEN 'cancelled'
        WHEN pm.is_closed AND pm.pc >= 2        THEN 'played'
        WHEN pm.is_closed AND pm.pc < 2         THEN 'fell_through'
        ELSE 'pending'  -- not cancelled, not yet closed (closure window not elapsed)
      END                                                                       AS outcome,
      -- Strict quality gates (only meaningful when outcome = 'played').
      (pm.nsc = 0 AND pm.unk = 0)                                                AS gate_attendance,
      (pm.lc = 0)                                                                AS gate_punctual,
      (pm.rc > 0 AND pm.avg_rating >= 4)                                         AS gate_rated,
      (pm.rep = 0)                                                               AS gate_clean
    FROM per_match pm
  )
  SELECT
    f.date,
    f.sport_id,
    f.sport_name,
    f.is_auto_generated,
    COUNT(*)                                                              AS matches_created,
    COUNT(*) FILTER (WHERE f.is_filled)                                   AS matches_filled,
    COUNT(*) FILTER (WHERE f.outcome = 'played')                          AS matches_played,
    COUNT(*) FILTER (
      WHERE f.outcome = 'played' AND f.gate_attendance AND f.gate_punctual
        AND f.gate_rated AND f.gate_clean
    )                                                                     AS matches_quality,
    COUNT(*) FILTER (WHERE f.outcome = 'cancelled')                       AS matches_cancelled,
    COUNT(*) FILTER (WHERE f.outcome = 'mutual')                          AS matches_mutual_cancel,
    COUNT(*) FILTER (WHERE f.outcome = 'fell_through')                    AS matches_fell_through,
    COUNT(*) FILTER (WHERE f.outcome = 'pending')                         AS matches_pending,
    COUNT(*) FILTER (WHERE f.outcome = 'played' AND f.nsc > 0)                     AS played_no_show,
    COUNT(*) FILTER (WHERE f.outcome = 'played' AND f.lc > 0)                      AS played_late,
    COUNT(*) FILTER (WHERE f.outcome = 'played' AND f.rc > 0 AND f.avg_rating < 4) AS played_low_rating,
    COUNT(*) FILTER (WHERE f.outcome = 'played' AND f.rep > 0)                     AS played_reported,
    COALESCE(SUM(f.rs) FILTER (WHERE f.outcome = 'played'), 0)::bigint    AS rating_sum,
    COALESCE(SUM(f.rc) FILTER (WHERE f.outcome = 'played'), 0)::bigint    AS rating_count,
    COALESCE(SUM(f.jc)  FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_expected,
    COALESCE(SUM(f.fbc) FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_present
  FROM flagged f
  GROUP BY f.date, f.sport_id, f.sport_name, f.is_auto_generated
  ORDER BY f.date, f.sport_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_match_quality_analytics(date, date) TO authenticated;

COMMENT ON FUNCTION get_match_quality_analytics IS
  'Daily, per-sport match lifecycle funnel keyed on play date (match_date): created -> filled -> played (>=2 present) -> quality (strict). Strict quality requires played + full attendance + punctual + avg rating >= 4 + no reports, judged from closure aggregates on match_participant. Returns drop-off branches, quality-miss diagnostics, rating sum/count, and feedback coverage. Rows split by is_auto_generated.';
