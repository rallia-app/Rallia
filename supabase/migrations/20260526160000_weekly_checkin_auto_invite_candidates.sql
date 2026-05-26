-- =============================================================================
-- Auto-invite: candidate selection for weekly check-in matches.
--
-- Read-only ranked list of opponents to auto-invite to an auto-created match.
-- Deliberately a lean, dedicated query (NOT the full suggestion engine), but it
-- mirrors that engine's CORE compatibility factors so rankings stay directionally
-- consistent with matchup suggestions:
--   • effective rating per sport via the same precedence
--     (certified / is_certified / referrals>=3 / approved_proofs>=1 > normal >
--      disputed, then most-recent assigned_at);
--   • rating-proximity bands (0=1.0, <=0.5=0.7, <=1.0=0.3, else 0);
--   • match-type compatibility (exact=1.0, either 'both'=0.7, else 0);
--   • reputation (player_reputation.reputation_score);
--   • block-list exclusion (both directions).
-- It intentionally DROPS the engine's heavy history score and the shared-favorite-
-- facility requirement (those are the slow / restrictive parts).
--
-- Auto-invite-specific guards on top:
--   • opponent must be available at the match's exact weekday + start hour;
--   • within their max_travel_distance (km) of the match facility (skipped when
--     the match has no facility / the player has no location);
--   • not the host, not already a participant of this match;
--   • not already committed to an overlapping match (no double-booking);
--   • under the per-week auto-invite cap (anti-spam).
--
-- Side effects (inserting the pending invites + sending the localized
-- match_invitation notifications) live in the generate-weekly-matches edge
-- function, mirroring the send-match-reminders pattern.
-- =============================================================================

-- Param shape changed (added p_exclude) — drop the prior signature first.
DROP FUNCTION IF EXISTS public.get_auto_invite_candidates(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates(
  p_match_id    uuid,
  p_max         int DEFAULT 3,
  p_weekly_cap  int DEFAULT 5,
  p_exclude     uuid[] DEFAULT '{}'::uuid[]  -- players already invited this run (one invite per user per generation)
)
RETURNS TABLE (player_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  m            record;
  v_host_rating double precision;
  v_week_start date;
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

  v_weekday    := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
                    [extract(dow from m.match_date)::int + 1]::day_enum;
  v_hour       := extract(hour from m.start_time)::int;
  v_week_start := date_trunc('week', m.match_date)::date;

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
     -- already invited earlier in this generation run → at most one invite/user
     AND NOT (p.id = ANY (p_exclude))
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
     -- not already in this match
     AND NOT EXISTS (
       SELECT 1 FROM public.match_participant mp0
        WHERE mp0.match_id = p_match_id AND mp0.player_id = p.id
     )
     -- not already committed to an overlapping match (no double-booking)
     AND NOT EXISTS (
       SELECT 1
         FROM public.match m2
         JOIN public.match_participant mp2
           ON mp2.match_id = m2.id AND mp2.player_id = p.id
          AND mp2.status IN ('joined','requested','pending','waitlisted')
        WHERE m2.cancelled_at IS NULL
          AND m2.match_date = m.match_date
          AND m2.start_time < m.end_time
          AND m2.end_time   > m.start_time
     )
     -- anti-spam: under the per-week auto-invite cap
     AND (
       SELECT count(*)
         FROM public.match_participant mp3
         JOIN public.match m3 ON m3.id = mp3.match_id
        WHERE mp3.player_id = p.id
          AND mp3.status = 'pending'
          AND m3.is_auto_generated = TRUE
          AND m3.match_date >= v_week_start
          AND m3.match_date <  v_week_start + 7
     ) < p_weekly_cap
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

COMMENT ON FUNCTION public.get_auto_invite_candidates(uuid, int, int, uuid[]) IS
  'Ranked opponents to auto-invite to an auto-created match. Lean dedicated query '
  'mirroring the suggestion engine''s core factors (effective rating, proximity '
  'bands, match-type, reputation, block-list); adds slot-availability, distance, '
  'not-busy, and per-week-cap guards. Read-only; invites + notifications are done '
  'by the generate-weekly-matches edge function.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates(uuid, int, int, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates(uuid, int, int, uuid[]) TO service_role;
