-- =============================================================================
-- Auto-invite reachability: shared favorite facility (strong signal) instead of
-- "willing to travel"
--
-- The old reach gate invited anyone whose home was within their OWN max_travel
-- radius (default 25km) of the match facility, and bypassed distance entirely for
-- TBD-location matches. Travel-willingness is a weak signal and produced low
-- response rates.
--
-- New gate (conservative): a candidate is reachable only if they ALSO favorite
-- the match's facility (sport-specific or all-sport) AND their home is within the
-- LESSER of 10km or their own max_travel_distance of it. A shared favorite
-- facility is a much stronger intent signal (see scripts/compatibility_analysis).
--
-- Consequence by design: TBD-location auto matches (facility_id IS NULL) have no
-- facility to share, so they auto-invite nobody — they stay publicly visible and
-- joinable by request, they just don't push proactive invites. Candidates with no
-- home location also can't clear the distance cap, so they're not invited.
--
-- Verbatim copy of the 20260609210000 get_auto_invite_candidates body with ONLY
-- the reach clause + comment changed. All other gates (exact active-rating, slot
-- availability, block-list, gender, dedupe, overlapping-commitment) and the
-- ranking (match-type > reputation) are unchanged.
-- =============================================================================

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
  m               record;
  v_host_score_id uuid;
  v_weekday       day_enum;
  v_hour          int;
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

  -- Host's active rating for the sport → the rating_score it points at.
  SELECT prs.rating_score_id INTO v_host_score_id
    FROM public.player_sport hps
    JOIN public.player_rating_score prs ON prs.id = hps.active_rating_score_id
   WHERE hps.player_id = m.created_by
     AND hps.sport_id  = m.sport_id;

  RETURN QUERY
  SELECT p.id
    FROM public.player p
    JOIN public.player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = m.sport_id AND ps.is_active
    JOIN public.player_availability pa
      ON pa.player_id = p.id AND pa.is_active
     AND pa.day = v_weekday AND pa.hour_of_day = v_hour
    LEFT JOIN public.player_rating_score cprs ON cprs.id = ps.active_rating_score_id
    LEFT JOIN public.player_reputation prep ON prep.player_id = p.id
   WHERE p.id <> m.created_by
     -- exact rating gate: candidate's ACTIVE rating is the same rating_score
     -- (system + value) as the host's. Unrated host = open to all, no gate.
     AND (v_host_score_id IS NULL OR cprs.rating_score_id = v_host_score_id)
     -- block-list, both directions
     AND NOT EXISTS (
       SELECT 1 FROM public.player_block b
        WHERE (b.player_id = m.created_by AND b.blocked_player_id = p.id)
           OR (b.player_id = p.id AND b.blocked_player_id = m.created_by)
     )
     -- the match's gender requirement, if any (mirrors join eligibility)
     AND (m.preferred_opponent_gender IS NULL OR p.gender = m.preferred_opponent_gender)
     -- strong-signal reach: the candidate must ALSO favorite the match's facility
     -- (sport-specific or all-sport) AND live within the LESSER of 10km or their
     -- own travel radius of it. No facility (TBD match) or no home location means
     -- no shared-facility signal, so not a candidate.
     AND m.facility_id IS NOT NULL
     AND p.location IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.player_favorite_facility pff
         JOIN public.facility f ON f.id = pff.facility_id
        WHERE pff.player_id  = p.id
          AND pff.facility_id = m.facility_id
          AND (pff.sport_id = m.sport_id OR pff.sport_id IS NULL)
          AND f.location IS NOT NULL
          AND extensions.ST_DWithin(
                f.location, p.location,
                LEAST(10, COALESCE(p.max_travel_distance, 10)) * 1000
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
  'Hard filters: candidate''s ACTIVE rating is the same rating_score as the '
  'host''s active rating (no gate when host has none), sport active, exact '
  'slot availability, block-list, gender, SHARED FAVORITE FACILITY (candidate '
  'favorites the match facility, sport-specific or all-sport, AND lives within '
  'Min(10km, their max_travel_distance) of it — TBD matches / no home location '
  'invite nobody), not already in the match, no overlapping JOINED commitment '
  '(own unfilled auto match exempt). Ranking: match-type > reputation. Push '
  'anti-spam lives in generate-weekly-matches.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates(uuid, int) TO service_role;
