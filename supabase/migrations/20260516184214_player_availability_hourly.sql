-- =============================================================================
-- Player availability: replace 6-block period_enum with per-hour cells
--
-- Today `player_availability.period` is `period_enum` with 6 values
-- (early 06-09, morning 09-12, midday 12-14, afternoon 14-17, evening 17-20,
-- late 20-23). Each row says "this player is available somewhere in this
-- 2-3 hour band on this day". For the suggestion engine to propose actual
-- 1-hour bookings, that's still too coarse — a player tagged "afternoon"
-- might mean 14:00 or 16:00, and we can't tell.
--
-- We move to one row per (player, day, hour_of_day) where hour_of_day is the
-- start of a whole 1-hour cell from 06:00 to 22:00 (22:00 covers the 22-23
-- window; 23:00 start is not supported). 17 cells per day × 7 days = 119
-- possible cells per player.
--
-- Backfill: each existing period row expands into N hourly rows:
--   early     → 6, 7, 8
--   morning   → 9, 10, 11
--   midday    → 12, 13
--   afternoon → 14, 15, 16
--   evening   → 17, 18, 19
--   late      → 20, 21, 22
-- `last_confirmed_at` is reset to NULL on every backfilled row so the
-- staleness banner fires for every existing user on next visit. No forced
-- re-onboarding.
--
-- The suggestion RPCs (`get_match_suggestions_scored`, `get_match_suggestions_anon`)
-- are recreated in this same migration to join on `hour_of_day` instead of
-- `period`. Saturation constants are re-tuned: overlap saturates at /12.0
-- (was /14.0) and anon density at /36.0 (was /42.0) — chosen so the same
-- real-time density produces roughly the same scaled score under the new
-- per-hour denominator (7×17=119 cells, ~30% fill ceiling).
--
-- `search_players_nearby` is dropped and recreated with two new optional
-- params `p_min_hour SMALLINT, p_max_hour SMALLINT` for hour-range filtering.
-- The legacy `p_availability TEXT` param is preserved as a no-op so any
-- pre-deploy client passing it still calls a matching signature; the
-- `availability` JSONB return column is dropped (PlayerCard no longer renders
-- it — see PR C).
--
-- Doing it all in one migration so the period column is never dropped while
-- any RPC body still references it. Wrapped in the implicit per-file
-- transaction Supabase uses.
-- =============================================================================

-- =============================================================================
-- PART 1 — Schema: add hour_of_day, backfill, delete originals
-- =============================================================================

-- 1.1 Add nullable hour_of_day so we can populate before tightening, and
--     temporarily relax period's NOT NULL so the backfill INSERT can write
--     rows that only carry hour_of_day. period is dropped entirely at the
--     end of this migration.
ALTER TABLE public.player_availability
  ADD COLUMN hour_of_day SMALLINT;

ALTER TABLE public.player_availability
  ALTER COLUMN period DROP NOT NULL;

-- 1.2 Backfill: expand each period row into N hourly rows. The 6 periods
--     partition the supported hour range disjointly so no two original rows
--     for the same player produce the same hour — a vanilla INSERT is safe
--     without ON CONFLICT. last_confirmed_at resets to NULL.
INSERT INTO public.player_availability (player_id, day, hour_of_day, is_active, last_confirmed_at)
SELECT pa.player_id, pa.day, h.hour, pa.is_active, NULL
FROM public.player_availability pa
CROSS JOIN LATERAL unnest(
  CASE pa.period::TEXT
    WHEN 'early'     THEN ARRAY[6, 7, 8]
    WHEN 'morning'   THEN ARRAY[9, 10, 11]
    WHEN 'midday'    THEN ARRAY[12, 13]
    WHEN 'afternoon' THEN ARRAY[14, 15, 16]
    WHEN 'evening'   THEN ARRAY[17, 18, 19]
    WHEN 'late'      THEN ARRAY[20, 21, 22]
  END
) AS h(hour)
WHERE pa.hour_of_day IS NULL;

-- 1.3 Delete the original period-keyed rows (those still have hour_of_day NULL).
DELETE FROM public.player_availability WHERE hour_of_day IS NULL;

-- =============================================================================
-- PART 2 — Recreate RPCs to use hour_of_day instead of period
--
-- Done BEFORE dropping the period column so we never leave a function body
-- in pg_proc that references a now-missing column. The bodies use ::TEXT
-- nowhere on period after this point; period_enum stops being referenced
-- entirely.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 get_match_suggestions_anon
--
-- Changes from prior version (20260515220100):
--   • opp_avail_density divisor: 42.0 → 36.0  (7×6 cells → ~30% fill of 7×17)
--   • overlap_json: keys 'day' + 'period' → 'day' + 'hour' (smallint)
-- All other CTEs, weights, joins unchanged.
-- -----------------------------------------------------------------------------

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

      CASE
        WHEN COALESCE(f.data_provider_id, org.data_provider_id) IS NULL THEN 0.5
        WHEN NOT EXISTS (
          SELECT 1 FROM public.facility_refresh_log frl
           WHERE frl.facility_id = f.id
        ) THEN 0.5
        ELSE LEAST(1.0, (
          SELECT COUNT(*)::numeric / 30.0
            FROM public.facility_availability_snapshot fas
           WHERE fas.facility_id  = f.id
             AND fas.is_available = TRUE
             AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
        ))
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

ALTER FUNCTION public.get_match_suggestions_anon(uuid, double precision, double precision, integer, integer)
  SET work_mem = '32MB';

COMMENT ON FUNCTION public.get_match_suggestions_anon(uuid, double precision, double precision, integer, integer) IS
  'Anon match suggestions. opp_avail_density now /36.0 (was /42.0) to keep [0,1] semantics after the hourly enum swap. overlapping_days_periods now returns {day, hour} objects instead of {day, period}.';

-- -----------------------------------------------------------------------------
-- 2.2 get_match_suggestions_scored
--
-- Changes from prior version (20260515220100 / 20260515190000):
--   • caller_avail CTE: select day, hour_of_day (was: day, period)
--   • opponent overlap join: oa.hour_of_day = ca.hour_of_day (was period)
--   • score_overlap saturation: /14.0 → /12.0
--   • overlap JSON: {day, hour} (was {day, period})
-- -----------------------------------------------------------------------------

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
  matchup_score                numeric,
  score_history                numeric
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
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_player_id
       AND ca.is_active  = TRUE
  ),

  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_player_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_player_id
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

  history_fb AS (
    SELECT mf.opponent_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END * ((mf.star_rating - 3)::numeric / 2.0)
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_signed_weighted,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_weight_sum,
      COUNT(*) FILTER (WHERE mf.showed_up = FALSE) AS no_shows,
      COUNT(*) FILTER (WHERE mf.was_late = TRUE)   AS lates,
      COUNT(*) AS fb_events
    FROM match_feedback mf
    JOIN match m ON m.id = mf.match_id
    WHERE mf.reviewer_id = p_player_id
    GROUP BY mf.opponent_id
  ),

  history_pm AS (
    SELECT other.player_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) AS pair_match_weight,
      COUNT(*) AS pair_match_count
    FROM match_participant me
    JOIN match m ON m.id = me.match_id
    JOIN match_participant other
      ON other.match_id = me.match_id
     AND other.player_id <> p_player_id
     AND other.status = 'joined'
    WHERE me.player_id = p_player_id
      AND me.status = 'joined'
      AND m.cancelled_at IS NULL
      AND m.match_date < CURRENT_DATE
    GROUP BY other.player_id
  ),

  history_fav AS (
    SELECT pf.favorite_player_id AS opp_id,
      TRUE AS caller_fav,
      EXISTS (
        SELECT 1 FROM player_favorite pf2
         WHERE pf2.player_id = pf.favorite_player_id
           AND pf2.favorite_player_id = p_player_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_player_id
  ),

  history_net AS (
    SELECT nm2.player_id AS opp_id,
      MAX(CASE nt.name
            WHEN 'friends'      THEN 0.20::numeric
            WHEN 'player_group' THEN 0.20::numeric
            WHEN 'club'         THEN 0.12::numeric
            WHEN 'community'    THEN 0.08::numeric
            WHEN 'private'      THEN 0.06::numeric
            WHEN 'public'       THEN 0.04::numeric
            ELSE 0.0::numeric
          END) AS net_weight,
      COUNT(*) AS net_events
    FROM network_member nm1
    JOIN network n          ON n.id = nm1.network_id
    JOIN network_type nt    ON nt.id = n.network_type_id
    JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                           AND nm2.player_id <> p_player_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_player_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),

  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= NOW() - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_player_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_player_id
    GROUP BY cp2.player_id
  ),

  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_player_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),

  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_player_id
    GROUP BY mr.reported_id
  ),

  history_universe AS (
    SELECT opp_id FROM history_fb
    UNION SELECT opp_id FROM history_pm
    UNION SELECT opp_id FROM history_fav
    UNION SELECT opp_id FROM history_net
    UNION SELECT opp_id FROM history_conv
    UNION SELECT opp_id FROM history_prep
    UNION SELECT opp_id FROM history_mrep
  ),

  history AS (
    SELECT
      u.opp_id,
      CASE
        WHEN (
          COALESCE(pm.pair_match_count, 0)
          + COALESCE(fb.fb_events, 0)
          + (CASE WHEN fav.caller_fav THEN 1 ELSE 0 END)
          + COALESCE(net.net_events, 0)
          + COALESCE(conv.convo_count, 0)
          + COALESCE(prep.rep_count, 0)
          + COALESCE(mrep.mrep_count, 0)
        ) < 2 THEN 0::numeric
        ELSE GREATEST(-0.5::numeric, LEAST(0.5::numeric,
            LEAST(0.40::numeric, COALESCE(pm.pair_match_weight, 0) * 0.10)
          + CASE
              WHEN fb.star_weight_sum IS NOT NULL AND fb.star_weight_sum > 0
              THEN GREATEST(-0.30::numeric, LEAST(0.30::numeric,
                     (fb.star_signed_weighted / fb.star_weight_sum) * 0.30))
              ELSE 0::numeric
            END
          + CASE WHEN fav.caller_fav THEN 0.15::numeric ELSE 0::numeric END
          + CASE WHEN fav.mutual_fav THEN 0.10::numeric ELSE 0::numeric END
          + LEAST(0.20::numeric, COALESCE(net.net_weight, 0))
          + LEAST(0.10::numeric,
              (CASE WHEN COALESCE(conv.convo_count, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            + (CASE WHEN COALESCE(conv.recent_msgs, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            )
          - LEAST(0.30::numeric, COALESCE(prep.rep_count, 0) * 0.20)
          - LEAST(0.20::numeric, COALESCE(mrep.mrep_count, 0) * 0.10)
          - LEAST(0.40::numeric, COALESCE(fb.no_shows, 0) * 0.25)
          - LEAST(0.10::numeric, COALESCE(fb.lates, 0) * 0.05)
        ))
      END::numeric(6,4) AS score_history
    FROM history_universe u
    LEFT JOIN history_pm   pm   ON pm.opp_id   = u.opp_id
    LEFT JOIN history_fb   fb   ON fb.opp_id   = u.opp_id
    LEFT JOIN history_fav  fav  ON fav.opp_id  = u.opp_id
    LEFT JOIN history_net  net  ON net.opp_id  = u.opp_id
    LEFT JOIN history_conv conv ON conv.opp_id = u.opp_id
    LEFT JOIN history_prep prep ON prep.opp_id = u.opp_id
    LEFT JOIN history_mrep mrep ON mrep.opp_id = u.opp_id
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
      COALESCE(prep.total_events, 0)            AS opp_rep_events,
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

      -- Hourly re-tune: saturate at 12 overlapping (day, hour) cells. The
      -- prior 6-block model saturated at 14 cells (≈2.3 fully overlapping
      -- days); the same real-time density expressed in 1-hour cells is ≈12.
      LEAST(
        (
          SELECT COUNT(*)::DECIMAL
            FROM caller_avail ca2
            JOIN player_availability oa
              ON oa.day         = ca2.day
             AND oa.hour_of_day = ca2.hour_of_day
             AND oa.player_id   = ps.player_id
             AND oa.is_active   = TRUE
        ) / 12.0,
        1.0
      ) AS score_overlap,

      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

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

      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS score_activity,

      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS opp_score_history

    FROM player_sport ps
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
    LEFT JOIN history h              ON h.opp_id       = ps.player_id
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
           ON oa_ex.day         = ca_ex.day
          AND oa_ex.hour_of_day = ca_ex.hour_of_day
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

      CASE
        WHEN COALESCE(f.data_provider_id, org.data_provider_id) IS NULL THEN 0.5
        WHEN NOT EXISTS (
          SELECT 1 FROM public.facility_refresh_log frl
           WHERE frl.facility_id = f.id
        ) THEN 0.5
        ELSE LEAST(1.0, (
          SELECT COUNT(*)::numeric / 30.0
            FROM public.facility_availability_snapshot fas
           WHERE fas.facility_id  = f.id
             AND fas.is_available = TRUE
             AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
        ))
      END AS score_bookability,

      (
        CASE WHEN EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_player_id
             AND cpff.facility_id = f.id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30 ELSE 0.0 END
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000)))
      ) AS score_facility_geo

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
      LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::DECIMAL(6,4) AS player_compat,
      LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)::DECIMAL(6,4) AS fac_affinity,
      (
        0.70 * LEAST(1.0, GREATEST(0.0,
          ( 0.18 * m.score_match_type
          + 0.18 * m.score_skill
          + 0.05 * m.score_duration
          + 0.22 * m.score_overlap
          + 0.10 * m.score_reputation
          + 0.17 * m.score_responsiveness
          + 0.10 * m.score_activity
          )
          + 0.5 * m.opp_score_history
          - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
        ))
      + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
      )::DECIMAL(8,4) AS total_score
    FROM matchups m
    ORDER BY (
      0.70 * LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))
    + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
    ) DESC
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
      -- Hourly overlap JSON: {day, hour} pairs for the caller×opponent
      -- intersection. Output column name unchanged for diffability; the TS
      -- layer renames downstream.
      SELECT COALESCE(json_agg(json_build_object('day', ca3.day, 'hour', ca3.hour_of_day)), '[]'::json)
        FROM caller_avail ca3
        JOIN player_availability oa2
          ON oa2.day         = ca3.day
         AND oa2.hour_of_day = ca3.hour_of_day
         AND oa2.player_id   = r.opp_id
         AND oa2.is_active   = TRUE
    )::JSONB AS overlap_json,
    r.opp_match_type, r.opp_match_duration,
    r.player_compat, r.fac_affinity, r.total_score,
    r.opp_score_history
  FROM ranked r
  ORDER BY r.total_score DESC;

END;
$function$;

ALTER FUNCTION public.get_match_suggestions_scored(uuid, uuid, integer, double precision, double precision)
  SET work_mem = '32MB';

COMMENT ON FUNCTION public.get_match_suggestions_scored(uuid, uuid, integer, double precision, double precision) IS
  'Auth match suggestions. score_overlap now saturates at /12.0 (was /14.0); join key is (day, hour_of_day) instead of (day, period); overlap JSON returns {day, hour} instead of {day, period}. All other CTEs and weights unchanged from 20260515190000.';

-- -----------------------------------------------------------------------------
-- 2.3 search_players_nearby
--
-- Signature change: drop the `availability` JSONB return column (the
-- PlayerCard widget that consumed it is being removed in a follow-up
-- commit). Add two new optional hour-range params `p_min_hour, p_max_hour`
-- (SMALLINT, 0..23). The legacy `p_availability TEXT` param is preserved
-- as a no-op to avoid breaking any in-flight client that still passes it;
-- it's silently ignored.
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_players_nearby(
  UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, NUMERIC, INT, TEXT, TEXT, TEXT,
  UUID[], UUID[], BOOLEAN, BOOLEAN, UUID[],
  TEXT, INT, INT,
  UUID[], TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.search_players_nearby(
  p_sport_id UUID,
  p_current_user_id UUID DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_min_skill_value NUMERIC DEFAULT NULL,
  p_min_travel_distance_km INT DEFAULT NULL,
  p_availability TEXT DEFAULT NULL,    -- DEPRECATED: no-op; preserved for client compat
  p_day TEXT DEFAULT NULL,
  p_play_style TEXT DEFAULT NULL,
  p_favorite_player_ids UUID[] DEFAULT NULL,
  p_blocked_player_ids UUID[] DEFAULT NULL,
  p_favorites_only BOOLEAN DEFAULT FALSE,
  p_blocked_only BOOLEAN DEFAULT FALSE,
  p_exclude_player_ids UUID[] DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'distance',
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_rating_score_ids UUID[] DEFAULT NULL,
  p_reputation_tier TEXT DEFAULT NULL,
  p_certified_only BOOLEAN DEFAULT FALSE,
  p_min_hour SMALLINT DEFAULT NULL,
  p_max_hour SMALLINT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  profile_picture_url TEXT,
  city TEXT,
  gender TEXT,
  rating_label TEXT,
  rating_value DOUBLE PRECISION,
  rating_is_certified BOOLEAN,
  rating_badge_status TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  total_count BIGINT,
  reputation_tier TEXT,
  reputation_score DOUBLE PRECISION,
  reputation_is_public BOOLEAN,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      prs.rating_score_id,
      rs.label::TEXT AS rating_label,
      rs.value::DOUBLE PRECISION AS rating_value,
      prs.is_certified AS rating_is_certified,
      CASE
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 'disputed'
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 'certified'
        ELSE 'self_declared'
      END AS rating_badge_status
    FROM public.player_rating_score prs
    JOIN public.rating_score rs ON rs.id = prs.rating_score_id
    JOIN public.rating_system rsys ON rsys.id = rs.rating_system_id
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
  filtered AS (
    SELECT
      p.id,
      pr.first_name::TEXT AS first_name,
      pr.last_name::TEXT AS last_name,
      pr.display_name::TEXT AS display_name,
      pr.profile_picture_url::TEXT AS profile_picture_url,
      p.city::TEXT AS city,
      p.gender::TEXT AS gender,
      er.rating_label,
      er.rating_value,
      er.rating_is_certified,
      er.rating_badge_status,
      p.latitude::DOUBLE PRECISION AS latitude,
      p.longitude::DOUBLE PRECISION AS longitude,
      CASE
        WHEN p_latitude IS NULL OR p_longitude IS NULL OR p.location IS NULL THEN NULL
        ELSE extensions.ST_Distance(
          p.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography
        )
      END AS distance_meters,
      pr.last_active_at,
      rep.reputation_tier::TEXT AS reputation_tier,
      rep.reputation_score::DOUBLE PRECISION AS reputation_score,
      rep.is_public AS reputation_is_public,
      p.last_seen_at
    FROM public.player p
    INNER JOIN public.player_sport ps
      ON ps.player_id = p.id
     AND ps.sport_id = p_sport_id
     AND (ps.is_active IS NULL OR ps.is_active = TRUE)
    INNER JOIN public.profile pr
      ON pr.id = p.id
     AND (pr.is_active IS NULL OR pr.is_active = TRUE)
    LEFT JOIN effective_rating er ON er.player_id = p.id
    LEFT JOIN public.player_reputation rep ON rep.player_id = p.id
    WHERE
      (p_current_user_id IS NULL OR p.id <> p_current_user_id)
      AND (p_exclude_player_ids IS NULL OR NOT (p.id = ANY(p_exclude_player_ids)))
      AND (
        NOT p_favorites_only
        OR (p_favorite_player_ids IS NOT NULL AND p.id = ANY(p_favorite_player_ids))
      )
      AND (
        CASE
          WHEN p_blocked_only THEN
            p_blocked_player_ids IS NOT NULL AND p.id = ANY(p_blocked_player_ids)
          WHEN p_blocked_player_ids IS NOT NULL THEN
            NOT (p.id = ANY(p_blocked_player_ids))
          ELSE TRUE
        END
      )
      AND (p_gender IS NULL OR p.gender::TEXT = p_gender)
      AND (p_min_skill_value IS NULL OR er.rating_value >= p_min_skill_value)
      AND (p_min_travel_distance_km IS NULL OR p.max_travel_distance >= p_min_travel_distance_km)
      AND (
        p_play_style IS NULL
        OR ps.preferred_play_style::TEXT = p_play_style
      )
      -- Hour-range filter: pass either or both of p_min_hour/p_max_hour, with
      -- optional p_day. NULL on a bound means open-ended. NULL on p_day means
      -- the hour window applies across the whole week.
      AND (
        (p_min_hour IS NULL AND p_max_hour IS NULL AND p_day IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.player_availability pa
          WHERE pa.player_id = p.id
            AND (pa.is_active IS NULL OR pa.is_active = TRUE)
            AND (p_day IS NULL OR pa.day::TEXT = p_day)
            AND (p_min_hour IS NULL OR pa.hour_of_day >= p_min_hour)
            AND (p_max_hour IS NULL OR pa.hour_of_day <= p_max_hour)
        )
      )
      AND (
        p_search_query IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(COALESCE(pr.first_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.last_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.display_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(p.city, '')) ILIKE '%' || extensions.unaccent(word) || '%'
          )
        )
      )
      AND (p_rating_score_ids IS NULL OR er.rating_score_id = ANY(p_rating_score_ids))
      AND (p_reputation_tier IS NULL OR rep.reputation_tier::TEXT = p_reputation_tier)
      AND (NOT p_certified_only OR er.rating_badge_status = 'certified')
  )
  SELECT
    f.id,
    f.first_name,
    f.last_name,
    f.display_name,
    f.profile_picture_url,
    f.city,
    f.gender,
    f.rating_label,
    f.rating_value,
    f.rating_is_certified,
    f.rating_badge_status,
    f.latitude,
    f.longitude,
    f.distance_meters,
    COUNT(*) OVER ()::BIGINT AS total_count,
    f.reputation_tier,
    f.reputation_score,
    f.reputation_is_public,
    f.last_seen_at
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort_by = 'distance' THEN f.distance_meters END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_asc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_desc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_high' THEN f.rating_value END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_low' THEN f.rating_value END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'recently_active' THEN f.last_active_at END DESC NULLS LAST,
    f.id ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION public.search_players_nearby IS
  'Server-side player directory search. Returns a paginated, filtered, sorted slice with rating, reputation, and online status. Adds optional (p_min_hour, p_max_hour) for hour-range availability filtering; deprecates p_availability (no-op). The availability JSONB return column is gone now that PlayerCard does not render it. Distance via PostGIS when p_latitude/p_longitude provided.';

GRANT EXECUTE ON FUNCTION public.search_players_nearby(
  UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, NUMERIC, INT, TEXT, TEXT, TEXT,
  UUID[], UUID[], BOOLEAN, BOOLEAN, UUID[],
  TEXT, INT, INT,
  UUID[], TEXT, BOOLEAN,
  SMALLINT, SMALLINT
) TO authenticated, anon;

-- =============================================================================
-- PART 3 — Drop legacy schema: period column, period_enum, period-keyed indexes
-- =============================================================================

-- 3.1 Drop indexes that reference period.
DROP INDEX IF EXISTS public.idx_player_availabilities_period;
DROP INDEX IF EXISTS public.idx_player_availability_active_lookup;

-- 3.2 Drop the legacy unique constraint on (player_id, day, period).
ALTER TABLE public.player_availability
  DROP CONSTRAINT IF EXISTS uq_player_availabilities_player_day_period;

-- 3.3 Drop the period column. RPCs above have already been recreated so the
--     drop has no dependents.
ALTER TABLE public.player_availability DROP COLUMN period;

-- 3.4 Drop the now-unused enum.
DROP TYPE public.period_enum;

-- =============================================================================
-- PART 4 — Tighten hour_of_day: NOT NULL, range CHECK, unique key, hot-path index
-- =============================================================================

ALTER TABLE public.player_availability
  ALTER COLUMN hour_of_day SET NOT NULL;

ALTER TABLE public.player_availability
  ADD CONSTRAINT player_availability_hour_of_day_check
    CHECK (hour_of_day BETWEEN 6 AND 22);

ALTER TABLE public.player_availability
  ADD CONSTRAINT uq_player_availability_player_day_hour
    UNIQUE (player_id, day, hour_of_day);

CREATE INDEX idx_player_availability_active_lookup
  ON public.player_availability (player_id, day, hour_of_day)
  WHERE is_active = TRUE;

COMMENT ON COLUMN public.player_availability.hour_of_day IS
  'Whole-hour cell from the 7×17 weekly grid (6..22 inclusive). hour_of_day = h '
  'represents the [h:00, h+1:00) window; the 22 cell covers 22:00–23:00. Replaces '
  'the 6-value period_enum. The suggestion RPCs join on (day, hour_of_day) and '
  'saturate at 12 overlapping cells.';
