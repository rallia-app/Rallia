-- ============================================
-- RPC: get_match_suggestions_anon
-- ============================================
-- Anonymous variant of get_match_suggestions_scored. Takes the caller's sport
-- + lat/lng directly (no player profile lookup) and returns the same column
-- shape so the TypeScript service layer can reuse the same downstream
-- pipeline (court availability, busy-slot conflict filtering, slot generation).
--
-- Caller-side scoring components (match type, skill, duration, availability
-- overlap, reputation) are emitted as a neutral 0.5 — there is no caller
-- profile to compare against. Facility affinity remains a continuous
-- distance-based decay. The "overlapping_days_periods" column carries the
-- opponent's full active availability (since there is no caller availability
-- to intersect with) — same JSON shape, different semantics.

CREATE OR REPLACE FUNCTION get_match_suggestions_anon(
  p_sport_id          UUID,
  p_lat               DOUBLE PRECISION,
  p_lng               DOUBLE PRECISION,
  p_max_distance_km   INT DEFAULT 25,
  p_limit             INT DEFAULT 50
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
  -- Opponent availability (full, no caller intersection)
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
  v_caller_location extensions.geography;
BEGIN
  v_caller_location :=
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;

  IF v_caller_location IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  opponents AS (
    SELECT
      ps.player_id                              AS opp_id,
      COALESCE(pr.first_name, '')               AS opp_first_name,
      COALESCE(pr.last_name, '')                AS opp_last_name,
      pr.profile_picture_url                    AS opp_avatar,
      opp.location                              AS opp_location,
      opp.max_travel_distance                   AS opp_max_distance,
      ps.preferred_match_type                   AS opp_match_type,
      ps.preferred_match_duration               AS opp_match_duration,
      COALESCE(prep.reputation_score, 0)        AS opp_rep_score,
      COALESCE(prep.reputation_tier, 'unknown') AS opp_rep_tier,
      COALESCE(prep.is_public, FALSE)           AS opp_rep_public,
      rs.value                                  AS opp_rating_value,
      rs.label::TEXT                            AS opp_rating_label,
      prs.badge_status                          AS opp_badge_status,

      -- Opponent's full active availability (acts as overlap_json for the client)
      (
        SELECT COALESCE(json_agg(json_build_object(
                 'day', oa.day,
                 'period', oa.period
               )), '[]'::json)
          FROM player_availability oa
         WHERE oa.player_id = ps.player_id
           AND oa.is_active = TRUE
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
   WHERE ps.sport_id  = p_sport_id
     AND opp.location IS NOT NULL
     AND extensions.ST_DWithin(opp.location, v_caller_location, p_max_distance_km * 1000)
     -- Only opponents who have at least one active availability slot
     AND EXISTS (
       SELECT 1
         FROM player_availability pa_ex
        WHERE pa_ex.player_id = ps.player_id
          AND pa_ex.is_active = TRUE
     )
  ),

  matchups AS (
    SELECT
      o.*,
      f.id                          AS fac_id,
      f.name::TEXT                  AS fac_name,
      COALESCE(f.address, '')::TEXT AS fac_address,
      COALESCE(f.city, '')::TEXT    AS fac_city,
      f.external_provider_id        AS fac_external_id,
      f.timezone                    AS fac_timezone,
      COALESCE(f.data_provider_id, org.data_provider_id)             AS fac_dp_id,
      COALESCE(fp.provider_type, op_dp.provider_type)                AS fac_dp_type,
      COALESCE(fp.booking_url_template, op_dp.booking_url_template)  AS fac_booking_tpl,

      extensions.ST_Distance(f.location, v_caller_location) AS dist_caller,
      extensions.ST_Distance(f.location, o.opp_location)    AS dist_opponent,

      -- Facility affinity: 0.6 caller-distance + 0.4 opponent-distance, both decay-clamped
      (
        GREATEST(
          0,
          0.6 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (p_max_distance_km * 1000.0))
        )
        +
        GREATEST(
          0,
          0.4 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000.0))
        )
      ) AS score_facility

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id = o.opp_id
     AND pff.sport_id  = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, p_max_distance_km * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  )

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
    -- Player compatibility: neutral 0.5 (same as the auth path's "unknown rating" branch).
    -- Preserves the service-layer quality threshold so anon results survive filtering.
    0.5000::DECIMAL(6,4) AS player_compat,
    LEAST(m.score_facility, 1.0)::DECIMAL(6,4) AS fac_affinity,
    -- Total: 70% neutral compat + 30% facility affinity
    (0.70 * 0.5 + 0.30 * LEAST(m.score_facility, 1.0))::DECIMAL(8,4) AS total_score
  FROM matchups m
  ORDER BY total_score DESC, dist_caller ASC
  LIMIT p_limit;

END;
$$;

GRANT EXECUTE ON FUNCTION get_match_suggestions_anon(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INT, INT)
  TO anon, authenticated;

COMMENT ON FUNCTION get_match_suggestions_anon IS
  'Anonymous matchup suggestions by sport + caller lat/lng. Returns the same '
  'column shape as get_match_suggestions_scored so the TS service layer is '
  'shared. Caller-side scores are neutral; overlap_json is the opponent''s '
  'full active availability (no caller intersection). Court availability '
  'still resolved in the service layer.';
