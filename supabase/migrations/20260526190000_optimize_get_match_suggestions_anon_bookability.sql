-- ════════════════════════════════════════════════════════════════════════
-- Optimize get_match_suggestions_anon — compute facility bookability ONCE
-- ════════════════════════════════════════════════════════════════════════
--
-- Sibling fix to 20260526180000 (get_just_for_you fix #3), applied to the
-- anon suggestion RPC. The anon Postgres role has a 3s statement_timeout
-- (vs 8s for authenticated), and this RPC was routinely running 1.3-3.7s on
-- staging — so anon callers (onboarding / Public Matches padding) were
-- hitting the 3s budget and surfacing as `[SuggestionService] RPC error`
-- 57014 (canceling statement due to statement timeout).
--
--   The `matchups.score_bookability` term used a correlated COUNT subquery
--   over `facility_availability_snapshot`. Worse than get_just_for_you: the
--   expression is textually referenced 4× (matchups output, ranked's
--   fac_affinity, ranked's total_score, and the ORDER BY), so Postgres ran
--   the per-facility aggregate FOUR times per matchup row. Measured on
--   staging (Montreal tennis caller, EXPLAIN ANALYZE BUFFERS): ~31k heap
--   fetches / ~22k of 25.7k total buffers were spent on bookability alone,
--   off a constantly-autovacuumed snapshot table with a stale visibility map.
--
--   We now compute the per-facility bookable count ONCE in a MATERIALIZED CTE
--   (`facility_bookable`), restricted to the candidate facilities (the
--   in-range favorited facilities of the nearby opponents), plus a small
--   `facility_refreshed` set for the "never refreshed → 0.5" branch, and
--   LEFT JOIN both into `matchups`. The snapshot is scanned a single grouped
--   pass instead of per-row-×4: total buffers drop 25.7k → 4.0k (~6.4×) and
--   bookability heap fetches ~31k → ~1.4k.
--
--   MATERIALIZED is required: without it the planner inlines the CTE and
--   re-runs the aggregate per matchup row (the exact regression we're fixing).
--
--   Result-equivalent: the bookability arithmetic is unchanged
--   (LEAST(1.0, count/30.0); 0.5 when no data provider; 0.5 when never
--   refreshed). Verified byte-identical output read-only on staging for two
--   sports (tennis + pickleball): 140 = 140 rows, 0 rows divergent in either
--   direction via EXCEPT on (opponent_id, facility_id, player_compatibility,
--   facility_affinity, matchup_score). The opponent set, facilities, and
--   overlap_json are produced by unchanged logic.
--
-- NOTE: wall-clock is noisy run-to-run due to autovacuum churn on the
-- snapshot table; the reliable signal is the ~6.4× reduction in buffer
-- traffic / heap fetches, which is what blows up to multi-second latency
-- under cold/contended cache (the source of the 3.7s p-max).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_match_suggestions_anon(
  p_sport_id         uuid,
  p_lat              double precision,
  p_lng              double precision,
  p_max_distance_km  integer DEFAULT 25,
  p_limit            integer DEFAULT 50
)
 RETURNS TABLE(
  opponent_id uuid, opponent_first_name text, opponent_last_name text, opponent_avatar text,
  opponent_reputation_score numeric, opponent_reputation_tier reputation_tier,
  opponent_rating_value double precision, opponent_rating_label text, opponent_badge_status badge_status_enum,
  facility_id uuid, facility_name text, facility_address text, facility_city text,
  facility_data_provider_id uuid, facility_provider_type text, facility_external_id text,
  facility_booking_url_tpl text, facility_timezone text, overlapping_days_periods jsonb,
  match_type match_type_enum, match_duration match_duration_enum,
  player_compatibility numeric, facility_affinity numeric, matchup_score numeric
)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET work_mem TO '32MB'
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
      COALESCE(prep.total_events, 0)            AS opp_rep_events,
      COALESCE(prep.is_public, FALSE)           AS opp_rep_public,
      er.rating_value                           AS opp_rating_value,
      er.rating_label                           AS opp_rating_label,
      er.badge_status                           AS opp_badge_status,

      -- Hourly re-tune: max grid size is 7 days × 17 hours = 119. We saturate
      -- at ~30% fill (≈36 active rows) so the density signal stays in [0,1]
      -- under realistic schedules.
      (
        SELECT COUNT(*)::DECIMAL / 36.0
          FROM player_availability oa
         WHERE oa.player_id = ps.player_id
           AND oa.is_active = TRUE
      )::DECIMAL(6,4) AS opp_avail_density,

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

  -- The in-range favorited facilities of the nearby opponents. Computed once
  -- so the bookability snapshot scan below can be restricted to exactly these
  -- facilities (a single grouped pass instead of a per-matchup-row subquery).
  candidate_facilities AS MATERIALIZED (
    SELECT DISTINCT f.id AS fac_id
    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id = o.opp_id AND pff.sport_id = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, p_max_distance_km * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  ),

  -- Per-facility bookable-slot count over the 3-day horizon, computed ONCE.
  -- Facilities with zero available rows simply don't appear here (the
  -- LEFT JOIN + COALESCE(...,0) below maps that to a 0.0 score, identical to
  -- the old COUNT(*)=0 subquery result).
  facility_bookable AS MATERIALIZED (
    SELECT fas.facility_id AS fac_id, COUNT(*)::numeric AS avail_cnt
    FROM public.facility_availability_snapshot fas
    WHERE fas.facility_id IN (SELECT fac_id FROM candidate_facilities)
      AND fas.is_available = TRUE
      AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
    GROUP BY fas.facility_id
  ),

  -- Candidate facilities that have been refreshed at least once. Absence here
  -- reproduces the old `NOT EXISTS (facility_refresh_log) → 0.5` branch.
  facility_refreshed AS MATERIALIZED (
    SELECT DISTINCT frl.facility_id AS fac_id
    FROM public.facility_refresh_log frl
    WHERE frl.facility_id IN (SELECT fac_id FROM candidate_facilities)
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

      -- Bookability, now read from the precomputed per-facility CTEs instead
      -- of a correlated snapshot subquery. Arithmetic is unchanged.
      CASE
        WHEN COALESCE(f.data_provider_id, org.data_provider_id) IS NULL THEN 0.5
        WHEN fr.fac_id IS NULL THEN 0.5
        ELSE LEAST(1.0, COALESCE(fb.avail_cnt, 0) / 30.0)
      END AS score_bookability,

      (
        GREATEST(0, 0.50 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (p_max_distance_km * 1000.0)))
      + GREATEST(0, 0.30 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000.0)))
      ) AS score_facility_geo

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id = o.opp_id AND pff.sport_id = p_sport_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
    LEFT JOIN facility_bookable fb ON fb.fac_id = f.id
    LEFT JOIN facility_refreshed fr ON fr.fac_id = f.id
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, p_max_distance_km * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  ),

  ranked AS MATERIALIZED (
    SELECT
      m.*,
      LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)::DECIMAL(6,4) AS fac_affinity,
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
      + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
      )::DECIMAL(8,4) AS total_score
    FROM matchups m
    ORDER BY (
        0.70 * (
          0.60 * m.opp_avail_density
        + 0.25 * m.opp_responsiveness
        + 0.15 * m.opp_activity
        )
      + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
    ) DESC,
    m.dist_caller ASC
    LIMIT p_limit
  )

  SELECT
    r.opp_id, r.opp_first_name, r.opp_last_name, r.opp_avatar,
    CASE WHEN r.opp_rep_public THEN r.opp_rep_score ELSE NULL END,
    CASE WHEN r.opp_rep_events < 5 THEN 'unknown'::reputation_tier ELSE r.opp_rep_tier END,
    r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
    r.fac_id, r.fac_name, r.fac_address, r.fac_city,
    r.fac_dp_id, r.fac_dp_type, r.fac_external_id, r.fac_booking_tpl, r.fac_timezone,
    (
      -- Hourly overlap JSON: { day, hour } pairs instead of { day, period }.
      -- Keep the column name `overlapping_days_periods` for output-shape
      -- backwards compatibility with the client (TS layer renames downstream).
      SELECT COALESCE(json_agg(json_build_object('day', oa.day, 'hour', oa.hour_of_day)), '[]'::json)
        FROM player_availability oa
       WHERE oa.player_id = r.opp_id AND oa.is_active = TRUE
    )::JSONB AS overlap_json,
    r.opp_match_type, r.opp_match_duration,
    r.player_compat, r.fac_affinity, r.total_score
  FROM ranked r
  ORDER BY r.total_score DESC, r.dist_caller ASC;

END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_match_suggestions_anon(
  uuid, double precision, double precision, integer, integer
) TO anon, authenticated;
