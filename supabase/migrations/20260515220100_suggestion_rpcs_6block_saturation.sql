-- =============================================================================
-- Suggestion RPCs: re-tune saturation constants for the 6-block availability
--
-- The previous migration (20260515220000_availability_6block_enum_and_backfill)
-- doubled the availability granularity from 3 periods/day → 6 blocks/day.
-- Existing rows were doubled (morning→early+morning, etc.), so raw counts in
-- the suggestion overlap formulas now scale ~2× as well. Without re-tuning,
-- two signals would inflate:
--
--   • score_overlap in get_match_suggestions_scored: the auth-path overlap
--     count saturates at /7.0. In the 3-period world, "1 full overlapping
--     day" = 3 hits, so saturation at 7 meant "≈2.3 overlapping days." In
--     the 6-block world the same real-time coverage produces ~2× hits, so
--     /14.0 preserves the saturation point at the same real-time density.
--
--   • opp_avail_density in get_match_suggestions_anon: total active rows / 21
--     ≈ "how filled-in is your 7×3 grid." Backfilled grids now have ≈2× rows
--     against the same denominator, blowing density past 1.0 and dominating
--     the anon ranking. /42.0 restores [0,1] semantics against the new 7×6
--     ceiling.
--
-- Nothing else changes — same opponent CTEs, same weights, same join paths.
-- The CTE join `oa.period = ca.period` is enum-agnostic, so the underlying
-- enum swap requires no body changes beyond the two constants.
--
-- Out of scope for this migration:
--   • `search_players_nearby` — its `pa.period::TEXT = p_availability`
--     predicate works identically against any enum value, so leaving the
--     signature TEXT (not TEXT[]) avoids a breaking change for production
--     mobile clients in the friends-and-family cohort. Macro AM/PM filters
--     in the new mobile UI are handled client-side.
--   • `get_time_slot_starts` and `generate_weekly_matches_for_player` —
--     dead code today (auto-match cron disabled by 20260321100000). Updating
--     them risks introducing a regression if they're ever reactivated. They
--     should be rewritten as part of the auto-match-generation revival, not
--     here.
-- =============================================================================

-- =============================================================================
-- ANON path
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

      -- 6-block re-tune: max grid size is 7 days × 6 blocks = 42 (was 21).
      (
        SELECT COUNT(*)::DECIMAL / 42.0
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

COMMENT ON FUNCTION public.get_match_suggestions_anon(uuid, double precision, double precision, integer, integer) IS
  'Anon match suggestions. opp_avail_density now /42.0 (was /21.0) to keep [0,1] semantics after the 6-block enum swap. facility_affinity = 0.50·caller-dist + 0.30·opp-dist + 0.20·bookability.';

-- =============================================================================
-- AUTH (scored) path
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

  -- ────────────────────────────────────────────────────────────────────────
  -- score_history sub-CTEs: caller-scoped scans keyed on opponent_id
  -- ────────────────────────────────────────────────────────────────────────

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

      -- 6-block re-tune: saturate at 14 overlapping (day, period) hits
      -- (was 7) so a couple "fully overlapping ~2.3 days" reaches 1.0 under
      -- the same real-time density as the legacy 3-period model.
      LEAST(
        (
          SELECT COUNT(*)::DECIMAL
            FROM caller_avail ca2
            JOIN player_availability oa
              ON oa.day  = ca2.day
             AND oa.period  = ca2.period
             AND oa.player_id   = ps.player_id
             AND oa.is_active   = TRUE
        ) / 14.0,
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
      -- Base content-signal player_compat (existing 7 weights, sum = 1.0).
      -- The history signal is applied as a clamped signed boost outside this
      -- so the base remains identical to the prior version for diffability.
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
      SELECT COALESCE(json_agg(json_build_object('day', ca3.day, 'period', ca3.period)), '[]'::json)
        FROM caller_avail ca3
        JOIN player_availability oa2
          ON oa2.day = ca3.day AND oa2.period = ca3.period
         AND oa2.player_id = r.opp_id AND oa2.is_active = TRUE
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
  'Auth match suggestions. score_overlap now saturates at /14.0 (was /7.0) to keep the saturation point at the same real-time density after the 6-block enum swap. score_history, disputed penalty, and all other signals unchanged from 20260515190000.';
