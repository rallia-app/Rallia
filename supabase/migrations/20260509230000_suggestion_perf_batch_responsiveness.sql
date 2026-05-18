-- ============================================================================
-- Migration: Performance — batch responsiveness + missing indexes
-- Created: 2026-05-09
-- Description:
--   At scale the previous setup was at risk of a hot-path bottleneck:
--   `player_responsiveness_score(opp_id)` was called once per opponent in the
--   pool (up to 500 calls per RPC invocation). Each call independently
--   aggregated `match_participant` for that player.
--
--   This migration:
--     1. Adds a batched `responsiveness` CTE inside both suggestion RPCs that
--        computes received/responded/accepted counts for every relevant
--        player in a single index scan, GROUP BY player_id. The opponents CTE
--        LEFT JOINs that result and the score is computed inline. Eliminates
--        the per-row function call.
--     2. Adds two missing indexes:
--        - `match_participant(created_at, player_id)` — supports the temporal
--          filter + group-by in the new responsiveness CTE.
--        - `player_availability(player_id, day, period) WHERE is_active` —
--          the unique index doesn't filter by is_active, so the planner had
--          to filter post-lookup. The partial index removes that.
--
--   The standalone `player_responsiveness_score(uuid, int)` function is kept
--   for ad-hoc / one-off queries (e.g., the smoke-test scripts). It's no
--   longer called from the hot path.
-- ============================================================================

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_match_participant_created_player
  ON match_participant (created_at, player_id);

CREATE INDEX IF NOT EXISTS idx_player_availability_active_lookup
  ON player_availability (player_id, day, period)
  WHERE is_active = TRUE;

-- =============================================================================
-- ANON
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_match_suggestions_anon(
  p_sport_id          uuid,
  p_lat               double precision,
  p_lng               double precision,
  p_max_distance_km   integer DEFAULT 25,
  p_limit             integer DEFAULT 50
)
RETURNS TABLE(
  opponent_id                  uuid,
  opponent_first_name          text,
  opponent_last_name           text,
  opponent_avatar              text,
  opponent_reputation_score    numeric,
  opponent_reputation_tier     reputation_tier,
  opponent_rating_value        double precision,
  opponent_rating_label        text,
  opponent_badge_status        badge_status_enum,
  facility_id                  uuid,
  facility_name                text,
  facility_address             text,
  facility_city                text,
  facility_data_provider_id    uuid,
  facility_provider_type       text,
  facility_external_id         text,
  facility_booking_url_tpl     text,
  facility_timezone            text,
  overlapping_days_periods     jsonb,
  match_type                   match_type_enum,
  match_duration               match_duration_enum,
  player_compatibility         numeric,
  facility_affinity            numeric,
  matchup_score                numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
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
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      CASE
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 2
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
        ELSE 1
      END DESC,
      prs.assigned_at DESC
  ),

  -- Batched responsiveness — one scan over the last 90 days of invites,
  -- grouped by recipient. Replaces per-row calls to
  -- public.player_responsiveness_score(...) inside the opponents CTE.
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= NOW() - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < NOW() - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

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
      er.rating_value                           AS opp_rating_value,
      er.rating_label                           AS opp_rating_label,
      er.badge_status                           AS opp_badge_status,

      (
        SELECT COUNT(*)::DECIMAL / 21.0
          FROM player_availability oa
         WHERE oa.player_id = ps.player_id
           AND oa.is_active = TRUE
      )::DECIMAL(6,4) AS opp_avail_density,

      -- Inline responsiveness score from the batched CTE. Cold-start default
      -- (0.5) when fewer than 3 received invites, or no row in the CTE.
      COALESCE(
        CASE
          WHEN r.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (r.responded::NUMERIC / NULLIF(r.received, 0))
            + 0.3 * (CASE
                       WHEN r.responded > 0
                       THEN r.accepted::NUMERIC / r.responded
                       ELSE 0.5
                     END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS opp_responsiveness,

      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS opp_activity

    FROM player_sport ps
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
   WHERE ps.sport_id  = p_sport_id
     AND opp.location IS NOT NULL
     AND extensions.ST_DWithin(opp.location, v_caller_location, p_max_distance_km * 1000)
     AND EXISTS (
       SELECT 1 FROM player_availability pa_ex
        WHERE pa_ex.player_id = ps.player_id AND pa_ex.is_active = TRUE
     )
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 200
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

      (
        GREATEST(0, 0.6 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (p_max_distance_km * 1000.0)))
      + GREATEST(0, 0.4 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000.0)))
      ) AS score_facility

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id = o.opp_id AND pff.sport_id = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, p_max_distance_km * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  ),

  ranked AS MATERIALIZED (
    SELECT
      m.*,
      LEAST(m.score_facility, 1.0)::DECIMAL(6,4) AS fac_affinity,
      (
        0.60 * m.opp_avail_density
      + 0.25 * m.opp_responsiveness
      + 0.15 * m.opp_activity
      )::DECIMAL(6,4) AS player_compat,
      (
        0.70 * (
          0.60 * m.opp_avail_density
        + 0.25 * m.opp_responsiveness
        + 0.15 * m.opp_activity
        )
      + 0.30 * LEAST(m.score_facility, 1.0)
      )::DECIMAL(8,4) AS total_score
    FROM matchups m
    ORDER BY (
        0.70 * (
          0.60 * m.opp_avail_density
        + 0.25 * m.opp_responsiveness
        + 0.15 * m.opp_activity
        )
      + 0.30 * LEAST(m.score_facility, 1.0)
    ) DESC,
    m.dist_caller ASC
    LIMIT p_limit
  )

  SELECT
    r.opp_id, r.opp_first_name, r.opp_last_name, r.opp_avatar,
    CASE WHEN r.opp_rep_public THEN r.opp_rep_score ELSE NULL END,
    r.opp_rep_tier, r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
    r.fac_id, r.fac_name, r.fac_address, r.fac_city,
    r.fac_dp_id, r.fac_dp_type, r.fac_external_id, r.fac_booking_tpl, r.fac_timezone,
    (
      SELECT COALESCE(json_agg(json_build_object('day', oa.day, 'period', oa.period)), '[]'::json)
        FROM player_availability oa
       WHERE oa.player_id = r.opp_id AND oa.is_active = TRUE
    )::JSONB AS overlap_json,
    r.opp_match_type, r.opp_match_duration,
    r.player_compat, r.fac_affinity, r.total_score
  FROM ranked r
  ORDER BY r.total_score DESC, r.dist_caller ASC;

END;
$function$;

ALTER FUNCTION public.get_match_suggestions_anon(uuid, double precision, double precision, integer, integer)
  SET work_mem = '32MB';

-- =============================================================================
-- SCORED (auth path)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_match_suggestions_scored(
  p_player_id uuid,
  p_sport_id  uuid,
  p_limit     integer          DEFAULT 50,
  p_lat       double precision DEFAULT NULL,
  p_lng       double precision DEFAULT NULL
)
RETURNS TABLE(
  opponent_id                  uuid,
  opponent_first_name          text,
  opponent_last_name           text,
  opponent_avatar              text,
  opponent_reputation_score    numeric,
  opponent_reputation_tier     reputation_tier,
  opponent_rating_value        double precision,
  opponent_rating_label        text,
  opponent_badge_status        badge_status_enum,
  facility_id                  uuid,
  facility_name                text,
  facility_address             text,
  facility_city                text,
  facility_data_provider_id    uuid,
  facility_provider_type       text,
  facility_external_id         text,
  facility_booking_url_tpl     text,
  facility_timezone            text,
  overlapping_days_periods     jsonb,
  match_type                   match_type_enum,
  match_duration               match_duration_enum,
  player_compatibility         numeric,
  facility_affinity            numeric,
  matchup_score                numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
BEGIN
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_player_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_rating_score prs
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
    JOIN rating_system  rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
   WHERE prs.player_id = p_player_id
   ORDER BY
     CASE
       WHEN prs.badge_status = 'certified'::badge_status_enum
         OR prs.is_certified
         OR prs.referrals_count >= 3
         OR prs.approved_proofs_count >= 1 THEN 2
       WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
       ELSE 1
     END DESC,
     prs.assigned_at DESC
   LIMIT 1;

  RETURN QUERY
  WITH
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      CASE
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 2
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
        ELSE 1
      END DESC,
      prs.assigned_at DESC
  ),

  caller_avail AS (
    SELECT ca.day, ca.period
      FROM player_availability ca
     WHERE ca.player_id = p_player_id
       AND ca.is_active  = TRUE
  ),

  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_player_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_player_id
  ),

  -- Batched responsiveness — one scan over the last 90 days of invites,
  -- grouped by recipient. Replaces per-row calls to
  -- public.player_responsiveness_score(...) inside the opponents CTE.
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= NOW() - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < NOW() - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

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
      COALESCE(prep.reputation_score, 0)        AS opp_rep_score,
      COALESCE(prep.reputation_tier, 'unknown') AS opp_rep_tier,
      COALESCE(prep.is_public, FALSE)           AS opp_rep_public,
      er.rating_value                           AS opp_rating_value,
      er.rating_label                           AS opp_rating_label,
      er.badge_status                           AS opp_badge_status,

      CASE
        WHEN v_caller_match_type = ps.preferred_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR ps.preferred_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,

      CASE
        WHEN v_caller_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      CASE
        WHEN v_caller_badge_status IS NULL THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.5
            WHEN 'self_declared' THEN 0.5
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 1.0
            WHEN 'self_declared' THEN 0.6
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.6
            WHEN 'self_declared' THEN 0.4
            WHEN 'disputed'      THEN 0.2
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.3
            WHEN 'self_declared' THEN 0.2
            WHEN 'disputed'      THEN 0.1
            ELSE 0.3
          END
        ELSE 0.5
      END AS score_skill,

      CASE
        WHEN v_caller_match_duration IS NULL OR ps.preferred_match_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = ps.preferred_match_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,

      LEAST(
        (
          SELECT COUNT(*)::DECIMAL
            FROM caller_avail ca2
            JOIN player_availability oa
              ON oa.day  = ca2.day
             AND oa.period  = ca2.period
             AND oa.player_id   = ps.player_id
             AND oa.is_active   = TRUE
        ) / 7.0,
        1.0
      ) AS score_overlap,

      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

      -- Inline responsiveness from the batched CTE, with cold-start default.
      COALESCE(
        CASE
          WHEN r.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (r.responded::NUMERIC / NULLIF(r.received, 0))
            + 0.3 * (CASE
                       WHEN r.responded > 0
                       THEN r.accepted::NUMERIC / r.responded
                       ELSE 0.5
                     END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,

      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS score_activity

    FROM player_sport ps
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
   WHERE ps.sport_id    = p_sport_id
     AND ps.player_id  != p_player_id
     AND opp.location   IS NOT NULL
     AND ps.player_id NOT IN (SELECT pid FROM blocked_ids)
     AND (
       v_caller_rating_value IS NULL
       OR er.rating_value IS NULL
       OR ABS(er.rating_value - v_caller_rating_value) <= 0.5
     )
     AND EXISTS (
       SELECT 1
         FROM caller_avail ca_ex
         JOIN player_availability oa_ex
           ON oa_ex.day  = ca_ex.day
          AND oa_ex.period  = ca_ex.period
          AND oa_ex.player_id   = ps.player_id
          AND oa_ex.is_active   = TRUE
     )
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 500
  ),

  matchups AS (
    SELECT
      o.*,
      f.id              AS fac_id,
      f.name::TEXT      AS fac_name,
      COALESCE(f.address, '')::TEXT   AS fac_address,
      COALESCE(f.city, '')::TEXT      AS fac_city,
      f.external_provider_id    AS fac_external_id,
      f.timezone                AS fac_timezone,
      COALESCE(f.data_provider_id, org.data_provider_id) AS fac_dp_id,
      COALESCE(fp.provider_type, op_dp.provider_type)    AS fac_dp_type,
      COALESCE(fp.booking_url_template, op_dp.booking_url_template) AS fac_booking_tpl,

      extensions.ST_Distance(f.location, v_caller_location) AS dist_caller,
      extensions.ST_Distance(f.location, o.opp_location)    AS dist_opponent,

      (
        CASE WHEN EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_player_id
             AND cpff.facility_id = f.id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.4 ELSE 0.0 END
        +
        GREATEST(0, 0.3 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        +
        GREATEST(0, 0.3 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000)))
      ) AS score_facility

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, COALESCE(v_caller_max_distance, 25) * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  ),

  ranked AS MATERIALIZED (
    SELECT
      m.*,
      (
        0.18 * m.score_match_type
      + 0.18 * m.score_skill
      + 0.05 * m.score_duration
      + 0.22 * m.score_overlap
      + 0.10 * m.score_reputation
      + 0.17 * m.score_responsiveness
      + 0.10 * m.score_activity
      )::DECIMAL(6,4) AS player_compat,
      LEAST(m.score_facility, 1.0)::DECIMAL(6,4) AS fac_affinity,
      (
        0.70 * (
          0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
      + 0.30 * LEAST(m.score_facility, 1.0)
      )::DECIMAL(8,4) AS total_score
    FROM matchups m
    ORDER BY (
      0.70 * (
        0.18 * m.score_match_type
      + 0.18 * m.score_skill
      + 0.05 * m.score_duration
      + 0.22 * m.score_overlap
      + 0.10 * m.score_reputation
      + 0.17 * m.score_responsiveness
      + 0.10 * m.score_activity
      )
    + 0.30 * LEAST(m.score_facility, 1.0)
    ) DESC
    LIMIT p_limit
  )

  SELECT
    r.opp_id, r.opp_first_name, r.opp_last_name, r.opp_avatar,
    CASE WHEN r.opp_rep_public THEN r.opp_rep_score ELSE NULL END,
    r.opp_rep_tier, r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
    r.fac_id, r.fac_name, r.fac_address, r.fac_city,
    r.fac_dp_id, r.fac_dp_type, r.fac_external_id, r.fac_booking_tpl, r.fac_timezone,
    (
      SELECT COALESCE(json_agg(json_build_object('day', ca3.day, 'period', ca3.period)), '[]'::json)
        FROM caller_avail ca3
        JOIN player_availability oa2
          ON oa2.day = ca3.day AND oa2.period = ca3.period
         AND oa2.player_id = r.opp_id AND oa2.is_active = TRUE
    )::JSONB AS overlap_json,
    r.opp_match_type, r.opp_match_duration,
    r.player_compat, r.fac_affinity, r.total_score
  FROM ranked r
  ORDER BY r.total_score DESC;

END;
$function$;

ALTER FUNCTION public.get_match_suggestions_scored(uuid, uuid, integer, double precision, double precision)
  SET work_mem = '32MB';

COMMENT ON FUNCTION public.get_match_suggestions_anon(uuid, double precision, double precision, integer, integer) IS
  'Anon-mode match suggestions. player_compat = 0.60·density + 0.25·responsiveness + '
  '0.15·activity. Responsiveness computed via batched CTE (one scan, one GROUP BY) '
  'instead of a per-row function call.';

COMMENT ON FUNCTION public.get_match_suggestions_scored(uuid, uuid, integer, double precision, double precision) IS
  'Auth-mode match suggestions. player_compat blends 7 components. Responsiveness '
  'computed via batched CTE (one scan, one GROUP BY) instead of a per-row function '
  'call. Symmetric ±0.5 rating filter and player_block exclusion at the opponent-'
  'eligibility stage.';
