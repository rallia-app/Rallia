-- Migration: Fix get_rating_score_referees referee_is_certified computation
-- The previous version read player_rating_score.is_certified directly, but the
-- effective "is this player certified?" check used across the app combines
-- multiple signals (see computeBadgeStatus in shared-services):
--   badge_status = 'certified'
--   OR is_certified = true
--   OR referrals_count >= 3
--   OR approved_proofs_count >= 1
-- This migration aligns the RPC with that logic so referees show the same
-- badge state here as they do on player directories / profile badges.

CREATE OR REPLACE FUNCTION public.get_rating_score_referees(
  p_player_rating_score_id uuid
)
RETURNS TABLE (
  referee_id              uuid,
  first_name              text,
  last_name               text,
  display_name            text,
  profile_picture_url     text,
  reference_rating_label  text,
  reference_rating_value  numeric,
  referee_rating_label    text,
  referee_rating_value    numeric,
  referee_is_certified    boolean,
  responded_at            timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH target AS (
    SELECT prs.rating_score_id,
           rs.value             AS current_value,
           rs.rating_system_id
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE prs.id = p_player_rating_score_id
  )
  SELECT
    rrr.referee_id,
    p.first_name,
    p.last_name,
    p.display_name,
    p.profile_picture_url,
    ref_rs.label           AS reference_rating_label,
    ref_rs.value           AS reference_rating_value,
    referee_rs.label       AS referee_rating_label,
    referee_rs.value       AS referee_rating_value,
    COALESCE(
      referee_prs.badge_status = 'certified'
      OR referee_prs.is_certified
      OR (referee_prs.referrals_count >= 3)
      OR (referee_prs.approved_proofs_count >= 1),
      false
    )                      AS referee_is_certified,
    rrr.responded_at
  FROM rating_reference_request rrr
  JOIN target t                     ON true
  JOIN rating_score ref_rs          ON ref_rs.id = rrr.rating_score_id
                                    AND ref_rs.rating_system_id = t.rating_system_id
                                    AND ref_rs.value >= t.current_value
  JOIN profile p                    ON p.id = rrr.referee_id
  LEFT JOIN player_rating_score referee_prs
                                    ON referee_prs.player_id = rrr.referee_id
                                   AND referee_prs.rating_score_id IN (
                                         SELECT id FROM rating_score
                                         WHERE rating_system_id = t.rating_system_id
                                       )
  LEFT JOIN rating_score referee_rs ON referee_rs.id = referee_prs.rating_score_id
  WHERE rrr.player_rating_score_id = p_player_rating_score_id
    AND rrr.status = 'completed'
    AND rrr.rating_supported = true
  ORDER BY rrr.responded_at DESC NULLS LAST;
$$;
