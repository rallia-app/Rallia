-- Migration: Add get_rating_score_referees RPC
-- Exposes the list of players who gave valid references for a given player_rating_score.
-- Scope matches certification counting: status='completed', rating_supported=true,
-- and reference level >= current rating level within the same rating system.
-- SECURITY DEFINER is used because rating_reference_request RLS limits SELECT to
-- requester/referee only; this function returns public-safe fields (profile basics
-- + rating label/value) and never exposes message or response_message.

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
    SELECT
      prs.rating_score_id,
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
    referee_prs.is_certified AS referee_is_certified,
    rrr.responded_at
  FROM rating_reference_request rrr
  JOIN target t                   ON true
  JOIN rating_score ref_rs        ON ref_rs.id = rrr.rating_score_id
                                  AND ref_rs.rating_system_id = t.rating_system_id
                                  AND ref_rs.value >= t.current_value
  JOIN profile p                  ON p.id = rrr.referee_id
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

COMMENT ON FUNCTION public.get_rating_score_referees(uuid) IS
  'Returns the list of referees (public-safe fields) who gave valid, level-scoped references '
  'for a given player_rating_score. Used to render the "who gave references" list on public profiles.';

GRANT EXECUTE ON FUNCTION public.get_rating_score_referees(uuid) TO authenticated;
