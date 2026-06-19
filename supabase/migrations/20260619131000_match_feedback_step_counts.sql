-- Migration: expose per-step participant feedback counts from get_match_quality_analytics.
--
-- The admin "Feedback" insight needs a per-participant completion funnel over closed
-- matches (the cohort where feedback was expected: played + fell_through). The function
-- already returns feedback_expected (SUM joined) and feedback_present (SUM attendance
-- reported); this adds the remaining post-match steps so the funnel is complete:
--   feedback_checked_in : joined participants with checked_in_at set
--   feedback_rated      : joined participants with a star_rating
--   feedback_done       : joined participants with feedback_completed = true
-- All measured over the same played+fell_through cohort as feedback_expected/present.
--
-- Return type changes (new columns), so drop + recreate.

DROP FUNCTION IF EXISTS get_match_quality_analytics(date, date);

CREATE OR REPLACE FUNCTION get_match_quality_analytics(
  p_start_date date,
  p_end_date   date
) RETURNS TABLE (
  date                   date,
  sport_id               uuid,
  sport_name             text,
  is_auto_generated      boolean,
  -- Funnel
  matches_created        bigint,
  matches_filled         bigint,
  matches_all_checked_in bigint,
  matches_all_feedback   bigint,
  matches_played         bigint,
  matches_quality        bigint,
  -- Drop-off branches
  matches_cancelled      bigint,
  matches_mutual_cancel  bigint,
  matches_fell_through   bigint,
  matches_pending        bigint,
  -- Why played matches missed the quality bar (overlapping diagnostics)
  played_no_show         bigint,
  played_late            bigint,
  played_low_rating      bigint,
  played_reported        bigint,
  played_incomplete      bigint,
  -- Avg rating (client computes rating_sum / rating_count)
  rating_sum             bigint,
  rating_count           bigint,
  -- Feedback coverage / per-step completion (over closed, played-eligible matches)
  feedback_expected      bigint,
  feedback_present       bigint,
  feedback_checked_in    bigint,
  feedback_rated         bigint,
  feedback_done          bigint
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
      COUNT(*) FILTER (WHERE mp.checked_in_at IS NOT NULL)           AS checked_in_count,
      COUNT(*) FILTER (WHERE mp.feedback_completed IS TRUE)          AS feedback_done_count,
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
      COALESCE(j.checked_in_count, 0)               AS cic,
      COALESCE(j.feedback_done_count, 0)            AS fdc,
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
      -- so the buckets partition `created` exactly. Played requires is_filled so it
      -- stays a subset of Filled; any other closed match falls to fell_through.
      CASE
        WHEN pm.is_mutual                                     THEN 'mutual'
        WHEN pm.is_cancelled                                  THEN 'cancelled'
        WHEN pm.is_closed AND pm.is_filled AND pm.pc >= 2     THEN 'played'
        WHEN pm.is_closed                                     THEN 'fell_through'
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
    -- Confirmation milestones over filled matches (is_filled implies jc >= 2).
    COUNT(*) FILTER (WHERE f.is_filled AND f.cic = f.jc)                  AS matches_all_checked_in,
    COUNT(*) FILTER (WHERE f.is_filled AND f.fdc = f.jc)                  AS matches_all_feedback,
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
    COUNT(*) FILTER (WHERE f.outcome = 'played' AND (f.unk > 0 OR f.rc = 0))       AS played_incomplete,
    COALESCE(SUM(f.rs) FILTER (WHERE f.outcome = 'played'), 0)::bigint    AS rating_sum,
    COALESCE(SUM(f.rc) FILTER (WHERE f.outcome = 'played'), 0)::bigint    AS rating_count,
    COALESCE(SUM(f.jc)  FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_expected,
    COALESCE(SUM(f.fbc) FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_present,
    COALESCE(SUM(f.cic) FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_checked_in,
    COALESCE(SUM(f.rc)  FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_rated,
    COALESCE(SUM(f.fdc) FILTER (WHERE f.outcome IN ('played', 'fell_through')), 0)::bigint AS feedback_done
  FROM flagged f
  GROUP BY f.date, f.sport_id, f.sport_name, f.is_auto_generated
  ORDER BY f.date, f.sport_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_match_quality_analytics(date, date) TO authenticated;

COMMENT ON FUNCTION get_match_quality_analytics IS
  'Daily, per-sport match lifecycle funnel keyed on play date (match_date): created -> filled -> all checked in -> all gave feedback -> played (filled + >=2 present) -> quality (strict). Played requires is_filled so the funnel stays nested. Drop-off diagnostics (no-show, late, low-rating, reported, incomplete) jointly cover every played-but-not-quality match. Feedback section reports per-step participant completion over the closed (played+fell_through) cohort: expected (joined), present (attendance reported), checked_in, rated, done (feedback_completed). Rows split by is_auto_generated.';
