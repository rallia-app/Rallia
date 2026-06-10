-- =============================================================================
-- Auto-invite v2: invite ALL relevant opponents, not a top-3 slice.
--
-- Product change: an auto-created match now invites every candidate that passes
-- the hard eligibility filters, and candidates self-select. The old funnel
-- (top-3 + one-invite-per-user-per-run + per-week pending cap) gated most of
-- the eligible demand out of a pool where the median player has ~5 compatible
-- partners. Anti-spam moves from rows to PUSHES: the generate-weekly-matches
-- edge function now sends ONE digest notification per candidate per check-in
-- ("X just checked in — N matches could interest you") under a cooldown +
-- weekly cap; invite rows past the cap still land silently in My Matches.
--
-- Signature: get_auto_invite_candidates(p_match_id, p_max) — p_exclude and
-- p_weekly_cap are gone. p_max is a safety bound (default 50), not targeting.
--
-- Guard changes vs v1:
--   • only a real commitment blocks a candidate: an overlapping 'joined' row.
--     'pending'/'requested'/'waitlisted' no longer hold the calendar — under
--     invite-all, counting unanswered invites as commitments would let the
--     first check-in of the week soft-lock the whole compatible pool;
--   • a candidate's own still-unfilled auto-generated match is a placeholder,
--     not a commitment — without this carve-out, two compatible hosts whose
--     auto matches share a slot could never be invited to each other's match
--     (mirrors the carve-out generate_weekly_matches_for_player already has);
--   • per-week pending cap removed (push cap lives in the edge function).
--
-- Unchanged: hard filters (sport active, exact slot availability, block-list
-- both directions, gender requirement, travel radius, not host / not already
-- in the match) and the ranking (rating proximity bands > match-type >
-- reputation) — ranking now orders the digest, it no longer gates.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_auto_invite_candidates(uuid, int, int, uuid[]);

CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates(
  p_match_id uuid,
  p_max      int DEFAULT 50  -- safety bound against pathological pools, not a targeting knob
)
RETURNS TABLE (player_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  m            record;
  v_host_rating double precision;
  v_weekday    day_enum;
  v_hour       int;
BEGIN
  SELECT mt.created_by, mt.sport_id, mt.match_date, mt.start_time, mt.end_time,
         mt.facility_id, mt.preferred_opponent_gender, mt.player_expectation,
         mt.cancelled_at
    INTO m
    FROM public.match mt
   WHERE mt.id = p_match_id;
  IF NOT FOUND OR m.cancelled_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_weekday := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
                 [extract(dow from m.match_date)::int + 1]::day_enum;
  v_hour    := extract(hour from m.start_time)::int;

  -- Host's effective rating for the sport (suggestion-engine precedence).
  SELECT rs.value INTO v_host_rating
    FROM public.player_rating_score prs
    JOIN public.rating_score  rs   ON rs.id   = prs.rating_score_id
    JOIN public.rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = m.sport_id
   WHERE prs.player_id = m.created_by
   ORDER BY
     CASE
       WHEN prs.badge_status = 'certified'::badge_status_enum
         OR prs.is_certified OR prs.referrals_count >= 3 OR prs.approved_proofs_count >= 1 THEN 2
       WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
       ELSE 1
     END DESC,
     prs.assigned_at DESC
   LIMIT 1;

  RETURN QUERY
  WITH eff AS (  -- effective rating per candidate for this sport (same precedence)
    SELECT DISTINCT ON (prs.player_id) prs.player_id, rs.value AS rating_value
      FROM public.player_rating_score prs
      JOIN public.rating_score  rs   ON rs.id   = prs.rating_score_id
      JOIN public.rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = m.sport_id
     ORDER BY prs.player_id,
       CASE
         WHEN prs.badge_status = 'certified'::badge_status_enum
           OR prs.is_certified OR prs.referrals_count >= 3 OR prs.approved_proofs_count >= 1 THEN 2
         WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
         ELSE 1
       END DESC,
       prs.assigned_at DESC
  )
  SELECT p.id
    FROM public.player p
    JOIN public.player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = m.sport_id AND ps.is_active
    JOIN public.player_availability pa
      ON pa.player_id = p.id AND pa.is_active
     AND pa.day = v_weekday AND pa.hour_of_day = v_hour
    LEFT JOIN eff ON eff.player_id = p.id
    LEFT JOIN public.player_reputation prep ON prep.player_id = p.id
   WHERE p.id <> m.created_by
     -- block-list, both directions
     AND NOT EXISTS (
       SELECT 1 FROM public.player_block b
        WHERE (b.player_id = m.created_by AND b.blocked_player_id = p.id)
           OR (b.player_id = p.id AND b.blocked_player_id = m.created_by)
     )
     -- the match's gender requirement, if any (mirrors join eligibility)
     AND (m.preferred_opponent_gender IS NULL OR p.gender = m.preferred_opponent_gender)
     -- reachable: within the candidate's travel radius of the facility
     AND (
       m.facility_id IS NULL OR p.location IS NULL
       OR EXISTS (
         SELECT 1 FROM public.facility f
          WHERE f.id = m.facility_id AND f.location IS NOT NULL
            AND extensions.ST_DWithin(f.location, p.location, COALESCE(p.max_travel_distance, 25) * 1000)
       )
     )
     -- not already in this match (any status: pending/declined/left rows stay authoritative)
     AND NOT EXISTS (
       SELECT 1 FROM public.match_participant mp0
        WHERE mp0.match_id = p_match_id AND mp0.player_id = p.id
     )
     -- no overlapping REAL commitment. Only 'joined' blocks; an unanswered
     -- invite or request is not a calendar hold. The candidate's own
     -- still-unfilled auto match (host row, no opponent joined) doesn't block.
     AND NOT EXISTS (
       SELECT 1
         FROM public.match m2
         JOIN public.match_participant mp2
           ON mp2.match_id = m2.id AND mp2.player_id = p.id
          AND mp2.status = 'joined'
        WHERE m2.cancelled_at IS NULL
          AND m2.match_date = m.match_date
          AND m2.start_time < m.end_time
          AND m2.end_time   > m.start_time
          AND NOT (
            m2.is_auto_generated = TRUE
            AND m2.created_by = p.id
            AND NOT EXISTS (
              SELECT 1 FROM public.match_participant mp4
               WHERE mp4.match_id = m2.id AND mp4.status = 'joined' AND mp4.player_id <> p.id
            )
          )
     )
   ORDER BY
     -- rating proximity (suggestion-engine bands)
     CASE
       WHEN v_host_rating IS NULL OR eff.rating_value IS NULL        THEN 0.5
       WHEN abs(v_host_rating - eff.rating_value) = 0                THEN 1.0
       WHEN abs(v_host_rating - eff.rating_value) <= 0.5             THEN 0.7
       WHEN abs(v_host_rating - eff.rating_value) <= 1.0             THEN 0.3
       ELSE 0.0
     END DESC,
     -- match-type compatibility
     CASE
       WHEN m.player_expectation = ps.preferred_match_type          THEN 1.0
       WHEN m.player_expectation = 'both' OR ps.preferred_match_type = 'both' THEN 0.7
       ELSE 0.0
     END DESC,
     -- reputation
     COALESCE(prep.reputation_score, 0) DESC
   LIMIT p_max;
END;
$$;

COMMENT ON FUNCTION public.get_auto_invite_candidates(uuid, int) IS
  'ALL eligible opponents (ranked) to auto-invite to an auto-created match. '
  'Hard filters: sport active, exact slot availability, block-list, gender, '
  'travel radius, not already in the match, no overlapping JOINED commitment '
  '(own unfilled auto match exempt). Ranking: rating proximity bands > '
  'match-type > reputation. p_max is a safety bound, not targeting. Push '
  'anti-spam (digest cooldown/cap) lives in generate-weekly-matches.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates(uuid, int) TO service_role;
