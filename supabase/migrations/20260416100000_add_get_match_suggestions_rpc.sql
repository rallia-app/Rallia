-- ============================================
-- RPC: get_match_suggestions_scored
-- ============================================
-- Computes scored (opponent, facility) matchup pairs for a given player and sport.
-- Returns only pairs where both players share at least one overlapping availability slot
-- and the facility is within both players' max_travel_distance.
--
-- Court availability is NOT checked here — that's handled by the TypeScript service layer
-- which calls external provider APIs (IC3/Otium, ActivityMessenger) and local court_slot data.
--
-- Scoring: weighted sum of player compatibility (match type, skill, duration, availability
-- overlap, reputation) and facility affinity (shared favorite, distance to both homes).

CREATE OR REPLACE FUNCTION get_match_suggestions_scored(
  p_player_id UUID,
  p_sport_id  UUID,
  p_limit     INT DEFAULT 50
)
RETURNS TABLE (
  -- Opponent info
  opponent_id                UUID,
  opponent_first_name        TEXT,
  opponent_last_name         TEXT,
  opponent_avatar            TEXT,
  opponent_reputation_score  DECIMAL(5,2),
  opponent_reputation_tier   reputation_tier,
  opponent_rating_value      DOUBLE PRECISION,
  opponent_rating_label      TEXT,
  opponent_badge_status      badge_status_enum,
  -- Facility info
  facility_id                UUID,
  facility_name              TEXT,
  facility_address           TEXT,
  facility_city              TEXT,
  facility_data_provider_id  UUID,
  facility_provider_type     TEXT,
  facility_external_id       TEXT,
  facility_booking_url_tpl   TEXT,
  facility_timezone          TEXT,
  -- Overlapping availability (caller ∩ opponent)
  overlapping_days_periods   JSONB,
  -- Match preferences (from opponent)
  match_type                 match_type_enum,
  match_duration             match_duration_enum,
  -- Scoring
  player_compatibility       DECIMAL(6,4),
  facility_affinity          DECIMAL(6,4),
  matchup_score              DECIMAL(8,4)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_caller_location        geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
BEGIN
  -- ── Resolve caller's profile ──────────────────────────────────────────
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_player_id;

  -- Bail out if caller has no location or sport preference
  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  -- ── Resolve caller's rating for this sport ────────────────────────────
  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_rating_score prs
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
   WHERE prs.player_id = p_player_id
   LIMIT 1;

  -- ── Main query ────────────────────────────────────────────────────────
  RETURN QUERY
  WITH
  -- Caller's availability slots (excluding night)
  caller_avail AS (
    SELECT ca.day, ca.period
      FROM player_availability ca
     WHERE ca.player_id = p_player_id
       AND ca.is_active  = TRUE
       -- period_enum only has morning/afternoon/evening (no night)
  ),

  -- All opponent candidates with player-level scoring
  opponents AS (
    SELECT
      ps.player_id                  AS opp_id,
      COALESCE(pr.first_name, '')   AS opp_first_name,
      COALESCE(pr.last_name, '')    AS opp_last_name,
      pr.profile_picture_url        AS opp_avatar,
      opp.location                  AS opp_location,
      opp.max_travel_distance       AS opp_max_distance,
      ps.preferred_match_type       AS opp_match_type,
      ps.preferred_match_duration   AS opp_match_duration,
      -- Reputation
      COALESCE(prep.reputation_score, 0) AS opp_rep_score,
      COALESCE(prep.reputation_tier, 'unknown') AS opp_rep_tier,
      COALESCE(prep.is_public, FALSE)    AS opp_rep_public,
      -- Rating
      rs.value                AS opp_rating_value,
      rs.label::TEXT         AS opp_rating_label,
      prs.badge_status              AS opp_badge_status,

      -- ── w1: Match type compatibility (0.0-1.0) ──
      CASE
        WHEN v_caller_match_type = ps.preferred_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR ps.preferred_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,

      -- ── w2: Skill proximity × rating confidence (0.0-1.0) ──
      -- Level closeness
      CASE
        WHEN v_caller_rating_value IS NULL OR rs.value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - rs.value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - rs.value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - rs.value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      -- Rating confidence multiplier
      CASE
        -- Caller has no rating
        WHEN v_caller_badge_status IS NULL THEN
          CASE prs.badge_status
            WHEN 'certified'     THEN 0.5
            WHEN 'self_declared' THEN 0.5
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5 -- opponent also has no rating
          END
        -- Caller is certified
        WHEN v_caller_badge_status = 'certified' THEN
          CASE prs.badge_status
            WHEN 'certified'     THEN 1.0
            WHEN 'self_declared' THEN 0.6
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        -- Caller is self_declared
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE prs.badge_status
            WHEN 'certified'     THEN 0.6
            WHEN 'self_declared' THEN 0.4
            WHEN 'disputed'      THEN 0.2
            ELSE 0.5
          END
        -- Caller is disputed
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE prs.badge_status
            WHEN 'certified'     THEN 0.3
            WHEN 'self_declared' THEN 0.2
            WHEN 'disputed'      THEN 0.1
            ELSE 0.3
          END
        ELSE 0.5
      END AS score_skill,

      -- ── w3: Duration compatibility (0.0-1.0) ──
      -- Enum values: '30', '60', '90', '120', 'custom'
      CASE
        WHEN v_caller_match_duration IS NULL OR ps.preferred_match_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = ps.preferred_match_duration THEN 1.0
        -- One step apart (30↔60, 60↔90, 90↔120)
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '90')
          THEN 0.5
        -- Two steps apart
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '60')
          THEN 0.3
        -- Three+ steps apart or custom
        ELSE 0.2
      END AS score_duration,

      -- ── w4: Availability overlap density (0.0-1.0) ──
      -- Computed via subquery: count of mutual slots / 21
      (
        SELECT COUNT(*)::DECIMAL / 21.0
          FROM caller_avail ca2
          JOIN player_availability oa
            ON oa.day  = ca2.day
           AND oa.period  = ca2.period
           AND oa.player_id   = ps.player_id
           AND oa.is_active   = TRUE
      ) AS score_overlap,

      -- ── w5: Opponent reputation (0.0-1.0) ──
      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

      -- Overlapping slots as JSONB (for service layer intersection)
      (
        SELECT COALESCE(json_agg(json_build_object(
                 'day', ca3.day,
                 'period', ca3.period
               )), '[]'::json)
          FROM caller_avail ca3
          JOIN player_availability oa2
            ON oa2.day  = ca3.day
           AND oa2.period  = ca3.period
           AND oa2.player_id   = ps.player_id
           AND oa2.is_active   = TRUE
      ) AS overlap_json

    FROM player_sport ps
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN player_rating_score prs
      ON prs.player_id = ps.player_id
    LEFT JOIN rating_score rs
      ON rs.id = prs.rating_score_id
    LEFT JOIN rating_system rsys
      ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
   WHERE ps.sport_id    = p_sport_id
     AND ps.player_id  != p_player_id
     AND opp.location   IS NOT NULL
     -- Only opponents with at least 1 mutual availability slot
     AND EXISTS (
       SELECT 1
         FROM caller_avail ca_ex
         JOIN player_availability oa_ex
           ON oa_ex.day  = ca_ex.day
          AND oa_ex.period  = ca_ex.period
          AND oa_ex.player_id   = ps.player_id
          AND oa_ex.is_active   = TRUE
     )
  ),

  -- Expand opponents × their favorite facilities, add facility affinity
  matchups AS (
    SELECT
      o.*,
      f.id              AS fac_id,
      f.name::TEXT      AS fac_name,
      COALESCE(f.address, '')::TEXT   AS fac_address,
      COALESCE(f.city, '')::TEXT      AS fac_city,
      f.external_provider_id    AS fac_external_id,
      f.timezone                AS fac_timezone,
      -- Resolved data provider (facility override > organization)
      COALESCE(f.data_provider_id, org.data_provider_id) AS fac_dp_id,
      COALESCE(fp.provider_type, op_dp.provider_type)    AS fac_dp_type,
      COALESCE(fp.booking_url_template, op_dp.booking_url_template) AS fac_booking_tpl,

      -- Distance from facility to caller (meters)
      ST_Distance(f.location, v_caller_location) AS dist_caller,
      -- Distance from facility to opponent (meters)
      ST_Distance(f.location, o.opp_location)    AS dist_opponent,

      -- ── w6: Facility affinity (0.0-1.0) ──
      (
        -- Shared favorite bonus: both players have this facility
        CASE WHEN EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_player_id
             AND cpff.facility_id = f.id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.4 ELSE 0.0 END
        +
        -- Distance to caller's home (0.0-0.3, continuous linear decay)
        GREATEST(0, 0.3 * (1.0 - ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        +
        -- Distance to opponent's home (0.0-0.3, continuous linear decay)
        GREATEST(0, 0.3 * (1.0 - ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000)))
      ) AS score_facility

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
    -- Resolve data provider through facility or organization
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
   WHERE f.location IS NOT NULL
     -- Facility within caller's max travel distance
     AND ST_DWithin(f.location, v_caller_location, COALESCE(v_caller_max_distance, 25) * 1000)
     -- Facility within opponent's max travel distance
     AND ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  )

  -- Final output with weighted score
  SELECT
    m.opp_id,
    m.opp_first_name,
    m.opp_last_name,
    m.opp_avatar,
    CASE WHEN m.opp_rep_public THEN m.opp_rep_score ELSE NULL END,
    m.opp_rep_tier,
    m.opp_rating_value,
    m.opp_rating_label,
    m.opp_badge_status,
    m.fac_id,
    m.fac_name,
    m.fac_address,
    m.fac_city,
    m.fac_dp_id,
    m.fac_dp_type,
    m.fac_external_id,
    m.fac_booking_tpl,
    m.fac_timezone,
    m.overlap_json::JSONB,
    m.opp_match_type,
    m.opp_match_duration,
    -- Player compatibility: normalized weighted sum of w1-w5 (sums to 1.0)
    -- w1=0.30 match type, w2=0.30 skill, w3=0.05 duration, w4=0.15 overlap, w5=0.20 reputation
    (
      0.30 * m.score_match_type
    + 0.30 * m.score_skill
    + 0.05 * m.score_duration
    + 0.15 * m.score_overlap
    + 0.20 * m.score_reputation
    )::DECIMAL(6,4) AS player_compat,
    -- Facility affinity (w6), capped at 1.0
    LEAST(m.score_facility, 1.0)::DECIMAL(6,4) AS fac_affinity,
    -- Total matchup score: 70% player + 30% facility
    (
      0.70 * (
        0.30 * m.score_match_type
      + 0.30 * m.score_skill
      + 0.05 * m.score_duration
      + 0.15 * m.score_overlap
      + 0.20 * m.score_reputation
      )
    + 0.30 * LEAST(m.score_facility, 1.0)
    )::DECIMAL(8,4) AS total_score
  FROM matchups m
  ORDER BY total_score DESC
  LIMIT p_limit;

END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION get_match_suggestions_scored(UUID, UUID, INT) TO authenticated;

COMMENT ON FUNCTION get_match_suggestions_scored IS
  'Returns scored (opponent, facility) matchup pairs for a player. '
  'Only returns pairs with mutual availability overlap and within both players'' travel distance. '
  'Court availability is resolved in the service layer via fetchUnifiedAvailability().';
