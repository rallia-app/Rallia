-- =============================================================================
-- RPCs: prefer the player's explicitly-active rating in per-candidate rating CTEs
--
-- Each of these functions resolves a player's rating for a sport via a DISTINCT ON
-- heuristic (certified status, then most-recent assigned_at). This makes the
-- player's explicitly-chosen active rating (player_sport.active_rating_score_id,
-- added in 20260608140000) win, falling back to the same heuristic when no active
-- rating is set. Only the DISTINCT ON tie-break changes; each CTE's SELECT list and
-- the surrounding query are untouched. NB: because the 20260608140000 backfill set
-- active = the heuristic winner, this is a no-op for existing data and only diverges
-- once a player picks a non-default active rating.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_just_for_you(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text DEFAULT NULL::text, p_limit integer DEFAULT 5, p_include_suggestions boolean DEFAULT true)
 RETURNS TABLE(kind text, score numeric, match_payload jsonb, suggestion_payload jsonb, player_compatibility numeric, facility_affinity numeric, score_history numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET work_mem TO '32MB'
 SET jit TO 'off'
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
  v_now                    TIMESTAMPTZ := NOW();
  v_pool_size              INT := GREATEST(p_limit * 4, 12);
BEGIN
  -- ── Caller context (location, travel cap, sport prefs) ────────────────
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_caller_id;

  -- Location override from RPC params (GPS / different area than stored home)
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  -- ── Caller's effective rating + badge (cert > self > disputed; recency tiebreak) ──
  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_rating_score prs
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
    JOIN rating_system  rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
   WHERE prs.player_id = p_caller_id
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
  -- ── Per-player effective rating for this sport ─────────────────────
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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

  -- ── Caller's active hourly availability cells ──────────────────────
  caller_avail AS (
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_caller_id
       AND ca.is_active  = TRUE
  ),

  -- ── Bidirectional blocklist ────────────────────────────────────────
  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_caller_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_caller_id
  ),

  -- ── [FIX #1] Caller's favorited facilities for this sport, and the set of
  --    opponents who share ≥1 of them. The suggestion pool can only ever
  --    surface opponents the caller shares a favorited facility with (the
  --    `matchups` join enforces this), so we prune to that set BEFORE the
  --    expensive per-opponent scoring instead of after. ─────────────────
  caller_fav_facilities AS (
    SELECT pff.facility_id
      FROM player_favorite_facility pff
     WHERE pff.player_id = p_caller_id
       AND pff.sport_id  = p_sport_id
  ),
  shared_fac_opponents AS (
    SELECT DISTINCT pff.player_id AS opp_id
      FROM player_favorite_facility pff
      JOIN caller_fav_facilities cff ON cff.facility_id = pff.facility_id
     WHERE pff.sport_id  = p_sport_id
       AND pff.player_id <> p_caller_id
       -- Matches-only gate: empties the suggestion pool at its root. Every
       -- suggestion CTE descends from here (caller_opp_overlap → overlap_counts
       -- → opponents → matchups → slots), so 0 rows here = no suggestion work.
       AND p_include_suggestions
  ),

  -- ── [FIX #2] Caller↔opponent availability overlap, computed ONCE. Joins
  --    the caller's active cells against opponents' active cells a single
  --    time (restricted to the shared-facility set) so the overlap filter,
  --    the overlap score, and slot expansion all reuse the same rows rather
  --    than re-probing player_availability per opponent. ─────────────────
  caller_opp_overlap AS (
    SELECT oa.player_id AS opp_id, ca.day, ca.hour_of_day
      FROM caller_avail ca
      JOIN player_availability oa
        ON oa.day         = ca.day
       AND oa.hour_of_day = ca.hour_of_day
       AND oa.is_active   = TRUE
       AND oa.player_id  <> p_caller_id
      -- Matches-only gate (also here so the player_availability scan itself is
      -- pruned when suggestions are off, not just emptied via the IN-subquery).
     WHERE p_include_suggestions
       AND oa.player_id IN (SELECT opp_id FROM shared_fac_opponents)
  ),
  overlap_counts AS (
    SELECT opp_id, COUNT(*) AS cells
      FROM caller_opp_overlap
     GROUP BY opp_id
  ),

  -- ── [FIX #3] Per-facility bookability score, computed ONCE for the caller's
  --    favorited facilities. MATERIALIZED so the planner can't inline it and
  --    re-run the snapshot aggregate per matchup row; the inner scan is
  --    restricted to caller facilities so it's a single grouped pass over
  --    facility_availability_snapshot instead of a per-row correlated COUNT.
  --    Replaces the old inline subquery that did ~50k heap fetches/request. ──
  facility_bookable AS MATERIALIZED (
    SELECT
      cff.facility_id,
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.facility_refresh_log frl WHERE frl.facility_id = cff.facility_id
        ) THEN 0.5
        ELSE LEAST(1.0, COALESCE(s.c, 0)::numeric / 30.0)
      END AS score_bookability
    FROM caller_fav_facilities cff
    LEFT JOIN (
      SELECT fas.facility_id, COUNT(*)::numeric AS c
        FROM public.facility_availability_snapshot fas
       WHERE fas.is_available = TRUE
         AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
         AND fas.facility_id IN (SELECT facility_id FROM caller_fav_facilities)
       GROUP BY fas.facility_id
    ) s ON s.facility_id = cff.facility_id
  ),

  -- ── Responsiveness (90-day window — applied to both creators and
  --    opponents; the join in each pool picks the relevant player_id) ──
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= v_now - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < v_now - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  -- ── Caller↔opponent history components (identical to both existing
  --    RPCs; the join in each pool keys on opp_id = creator/opponent) ──
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
    WHERE mf.reviewer_id = p_caller_id
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
     AND other.player_id <> p_caller_id
     AND other.status = 'joined'
    WHERE me.player_id = p_caller_id
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
           AND pf2.favorite_player_id = p_caller_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_caller_id
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
                           AND nm2.player_id <> p_caller_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_caller_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),
  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= v_now - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_caller_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_caller_id
    GROUP BY cp2.player_id
  ),
  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_caller_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),
  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_caller_id
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

  -- ═══════════════════════════════════════════════════════════════════
  -- MATCH POOL — mirrors get_upcoming_matches_scored, ranked + capped
  -- ═══════════════════════════════════════════════════════════════════
  candidate_matches AS (
    SELECT
      m.id                        AS m_id,
      m.created_by                AS creator_id,
      m.facility_id               AS m_facility_id,
      m.location_type             AS m_location_type,
      m.match_date                AS m_date,
      m.start_time                AS m_start_time,
      m.end_time                  AS m_end_time,
      m.duration                  AS m_duration,
      m.player_expectation        AS m_match_type,
      m.format                    AS m_format,
      m.court_status              AS m_court_status,
      m.is_court_free             AS m_is_court_free,
      m.estimated_cost            AS m_estimated_cost,
      m.preferred_opponent_gender AS m_preferred_gender,
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
        WHEN m.location_type = 'custom'
          AND m.custom_latitude IS NOT NULL
          AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        ELSE NULL
      END                          AS m_location,
      f.location                   AS facility_location,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          ELSE NULL
        END,
        v_caller_location
      )                            AS m_distance_meters
    FROM match m
    LEFT JOIN facility f      ON f.id      = m.facility_id
    LEFT JOIN rating_score mr ON mr.id     = m.min_rating_score_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND m.created_by <> p_caller_id
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id  = m.id
           AND mp.player_id = p_caller_id
           AND mp.status IN ('joined', 'requested', 'waitlisted')
      )
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp) > v_now
          ELSE
            (m.match_date + m.start_time)::timestamp > (v_now AT TIME ZONE 'UTC')::timestamp
        END
      )
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        END,
        v_caller_location,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      AND m.created_by NOT IN (SELECT pid FROM blocked_ids)
      AND (
        m.min_rating_score_id IS NULL
        OR v_caller_rating_value IS NULL
        OR v_caller_rating_value >= mr.value - 0.5
      )
  ),

  match_scored_base AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      cm.creator_id,
      cm.m_format,
      cm.m_court_status,
      cm.m_is_court_free,
      cm.m_estimated_cost,
      cm.m_preferred_gender,
      cm.m_date,
      er.badge_status AS creator_badge_status,
      CASE
        WHEN cm.m_match_type IS NULL THEN 0.5
        WHEN v_caller_match_type = cm.m_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR cm.m_match_type = 'both' THEN 0.7
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
          CASE er.badge_status WHEN 'certified' THEN 0.5 WHEN 'self_declared' THEN 0.5 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status WHEN 'certified' THEN 1.0 WHEN 'self_declared' THEN 0.6 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.6 WHEN 'self_declared' THEN 0.4 WHEN 'disputed' THEN 0.2 ELSE 0.5 END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.3 WHEN 'self_declared' THEN 0.2 WHEN 'disputed' THEN 0.1 ELSE 0.3 END
        ELSE 0.5
      END AS score_skill,
      CASE
        WHEN v_caller_match_duration IS NULL OR cm.m_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = cm.m_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,
      CASE
        WHEN cm.m_start_time IS NULL OR cm.m_end_time IS NULL THEN 0.5
        ELSE COALESCE((
          SELECT
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM caller_avail ca
               WHERE ca.day::TEXT = LOWER(TO_CHAR(cm.m_date, 'FMday'))
                 AND ca.hour_of_day = h.hr::smallint
            ) THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0)
          FROM generate_series(
            EXTRACT(HOUR FROM cm.m_start_time)::int,
            GREATEST(
              EXTRACT(HOUR FROM cm.m_start_time)::int,
              EXTRACT(HOUR FROM cm.m_end_time)::int - 1
            )
          ) AS h(hr)
        ), 0.0)
      END AS score_availability_fit,
      CASE
        WHEN COALESCE(rep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(rep.reputation_score, 50.0) / 100.0
      END AS score_reputation,
      COALESCE(
        CASE
          WHEN rs.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (rs.responded::NUMERIC / NULLIF(rs.received, 0))
            + 0.3 * (CASE WHEN rs.responded > 0 THEN rs.accepted::NUMERIC / rs.responded ELSE 0.5 END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,
      public.player_activity_score(cm.creator_id)::DECIMAL(6,4) AS score_activity,
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS pair_score_history,
      CASE
        WHEN cm.m_facility_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = cm.m_facility_id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30
        ELSE 0.0
      END AS fac_shared_fav_bonus,
      CASE
        WHEN cm.m_location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.m_location, v_caller_location)
                       / (COALESCE(v_caller_max_distance, 25) * 1000)))
      END AS fac_dist_caller,
      CASE
        WHEN cm.m_facility_id IS NULL
          OR cm.facility_location IS NULL
          OR creator_player.location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.facility_location, creator_player.location)
                       / (COALESCE(creator_player.max_travel_distance, 25) * 1000)))
      END AS fac_dist_creator
    FROM candidate_matches cm
    JOIN player creator_player      ON creator_player.id = cm.creator_id
    LEFT JOIN effective_rating er   ON er.player_id      = cm.creator_id
    LEFT JOIN player_reputation rep ON rep.player_id     = cm.creator_id
    LEFT JOIN responsiveness rs     ON rs.player_id      = cm.creator_id
    LEFT JOIN history h             ON h.opp_id          = cm.creator_id
  ),

  -- Composer-equivalent score for the carousel: server compatibility +
  -- facility affinity + the four TS-side actionability/tier/gender/cost
  -- signals (mirrors `scoreNearbyMatch` auth path in matchScoring.ts).
  -- Spots, tier, gender, cost are joined here against participants/cost so
  -- the ranking matches the legacy composer.
  match_signals AS (
    SELECT
      sb.*,
      LEAST(1.0, GREATEST(0.0,
        ( 0.18 * sb.score_match_type
        + 0.18 * sb.score_skill
        + 0.05 * sb.score_duration
        + 0.27 * sb.score_availability_fit
        + 0.05 * sb.score_reputation
        + 0.17 * sb.score_responsiveness
        + 0.10 * sb.score_activity
        )
        + 0.5 * sb.pair_score_history
        - (CASE WHEN sb.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::DECIMAL(6,4) AS player_compat,
      LEAST(1.0,
        sb.fac_shared_fav_bonus + sb.fac_dist_caller + sb.fac_dist_creator
      )::DECIMAL(6,4) AS fac_affinity,
      (
        CASE sb.m_format WHEN 'doubles' THEN 4 ELSE 2 END
        - COALESCE((
          SELECT COUNT(*) FROM match_participant pp
           WHERE pp.match_id = sb.m_id AND pp.status = 'joined'
        ), 0)
      ) AS spots_left,
      EXISTS (
        SELECT 1 FROM match_participant pp
        JOIN player_rating_score prs ON prs.player_id = pp.player_id
        JOIN rating_score rsc ON rsc.id = prs.rating_score_id
        JOIN rating_system rsy ON rsy.id = rsc.rating_system_id
        WHERE pp.match_id = sb.m_id
          AND pp.status = 'joined'
          AND rsy.sport_id = p_sport_id
          AND (
            prs.badge_status = 'certified'::badge_status_enum
            OR prs.is_certified
            OR prs.referrals_count >= 3
            OR prs.approved_proofs_count >= 1
          )
      ) AS has_certified_joined
    FROM match_scored_base sb
  ),

  match_with_cost AS (
    SELECT
      ms.*,
      -- Cost normalization is batch-relative; max() OVER () computes across
      -- the candidate pool so a 0..1 ratio falls out.
      (CASE
        WHEN ms.m_is_court_free OR ms.m_estimated_cost IS NULL OR ms.m_estimated_cost = 0 THEN 1.0
        WHEN COALESCE(MAX(ms.m_estimated_cost) OVER (), 0) <= 0 THEN 0.5
        ELSE GREATEST(0.1, 1.0 - ms.m_estimated_cost::numeric / MAX(ms.m_estimated_cost) OVER ())
      END)::numeric AS score_cost
    FROM match_signals ms
  ),

  scored_matches AS (
    SELECT
      mc.m_id,
      mc.creator_id,
      mc.m_distance_meters,
      mc.player_compat,
      mc.fac_affinity,
      mc.pair_score_history,
      -- Composer recipe (matchScoring.ts auth path): 0.55 pc + 0.20 fa + 0.10
      -- spots + 0.05 tier + 0.05 gender + 0.05 cost, plus REAL_ACTION_BONUS
      -- (0.05), urgency, and jitter.
      (
        0.55 * mc.player_compat
      + 0.20 * mc.fac_affinity
      + 0.10 * (CASE
          WHEN mc.spots_left <= 0 THEN 0.0
          WHEN mc.spots_left = 1  THEN 1.0
          WHEN mc.spots_left = 2  THEN 0.7
          WHEN mc.spots_left = 3  THEN 0.4
          ELSE 0.2
        END)
      + 0.05 * (CASE
          WHEN mc.has_certified_joined AND mc.m_court_status = 'reserved'::court_status_enum THEN 1.0
          WHEN mc.has_certified_joined OR  mc.m_court_status = 'reserved'::court_status_enum THEN 0.6
          ELSE 0.2
        END)
      + 0.05 * (CASE
          WHEN mc.m_preferred_gender IS NULL THEN 0.7
          WHEN p_user_gender IS NULL THEN 0.5
          WHEN mc.m_preferred_gender = p_user_gender::gender_enum THEN 1.0
          ELSE 0.3
        END)
      + 0.05 * mc.score_cost
      + 0.05  -- REAL_ACTION_BONUS (justForYouComposer.ts)
      + (CASE
          WHEN mc.m_date = CURRENT_DATE     THEN 0.05
          WHEN mc.m_date = CURRENT_DATE + 1 THEN 0.03
          WHEN mc.m_date = CURRENT_DATE + 2 THEN 0.01
          ELSE 0.0
        END)
      + ((random() - 0.5) * 0.06)  -- jitter ±0.03
      )::DECIMAL(8,4) AS final_score
    FROM match_with_cost mc
    ORDER BY (
      -- Pool ranking uses the player_compat × facility_affinity composite
      -- (without random) so the pre-filter cap is deterministic. The boosts
      -- only shape the final order across the merged top-N.
      0.70 * mc.player_compat + 0.30 * mc.fac_affinity
    ) DESC
    LIMIT v_pool_size
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- SUGGESTION POOL — mirrors get_match_suggestions_scored, then expands
  --                   into per-hour slots filtered by busy + snapshot
  -- ═══════════════════════════════════════════════════════════════════
  -- [FIX #1+#2] Opponents are now restricted to the shared-favorite-facility
  -- set via an INNER JOIN to overlap_counts (which is itself derived from
  -- shared_fac_opponents), and the overlap score reuses the precomputed
  -- overlap_counts.cells instead of a per-row correlated subquery. The old
  -- EXISTS availability filter is subsumed by the INNER JOIN.
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
          CASE er.badge_status WHEN 'certified' THEN 0.5 WHEN 'self_declared' THEN 0.5 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status WHEN 'certified' THEN 1.0 WHEN 'self_declared' THEN 0.6 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.6 WHEN 'self_declared' THEN 0.4 WHEN 'disputed' THEN 0.2 ELSE 0.5 END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.3 WHEN 'self_declared' THEN 0.2 WHEN 'disputed' THEN 0.1 ELSE 0.3 END
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
      LEAST(oc.cells::DECIMAL / 12.0, 1.0) AS score_overlap,
      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,
      COALESCE(
        CASE
          WHEN r.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (r.responded::NUMERIC / NULLIF(r.received, 0))
            + 0.3 * (CASE WHEN r.responded > 0 THEN r.accepted::NUMERIC / r.responded ELSE 0.5 END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,
      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS score_activity,
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS opp_score_history
    FROM player_sport ps
    JOIN overlap_counts oc ON oc.opp_id = ps.player_id
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
    LEFT JOIN history h              ON h.opp_id       = ps.player_id
   WHERE ps.sport_id    = p_sport_id
     AND ps.player_id  != p_caller_id
     AND opp.location   IS NOT NULL
     AND ps.player_id NOT IN (SELECT pid FROM blocked_ids)
     AND (
       v_caller_rating_value IS NULL
       OR er.rating_value IS NULL
       OR ABS(er.rating_value - v_caller_rating_value) <= 0.5
     )
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 200
  ),

  matchups AS (
    SELECT
      o.*,
      f.id              AS fac_id,
      f.name::TEXT      AS fac_name,
      COALESCE(f.address, '')::TEXT   AS fac_address,
      COALESCE(f.city, '')::TEXT      AS fac_city,
      f.timezone                AS fac_timezone,
      extensions.ST_Distance(f.location, v_caller_location) AS dist_caller,
      extensions.ST_Distance(f.location, o.opp_location)    AS dist_opponent,
      (
        CASE WHEN EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = f.id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30 ELSE 0.0 END
        + GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        + GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, o.opp_location)   / (COALESCE(o.opp_max_distance, 25)    * 1000)))
      ) AS score_facility_geo,
      -- [FIX #3] precomputed once in facility_bookable (was a per-row COUNT
      -- subquery over the snapshot). COALESCE guards the (impossible) miss:
      -- every matchup facility is one the caller favorited, so it's always
      -- present; 0.5 mirrors the old "no refresh log" neutral default.
      COALESCE(fb.score_bookability, 0.5) AS score_bookability
    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    -- Require the caller to ALSO have favorited this facility for this sport.
    JOIN player_favorite_facility cpff
      ON cpff.player_id   = p_caller_id
     AND cpff.sport_id    = p_sport_id
     AND cpff.facility_id = pff.facility_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN facility_bookable fb ON fb.facility_id = f.id
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, COALESCE(v_caller_max_distance, 25) * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location,   COALESCE(o.opp_max_distance, 25)    * 1000)
  ),

  ranked_suggestions AS MATERIALIZED (
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
      LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)::DECIMAL(6,4) AS fac_affinity
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
    LIMIT v_pool_size
  ),

  -- ── Slot expansion (port of generateFixedHourSlots) ─────────────────
  -- Cross-join the 7-day window with the caller×opponent overlap cells,
  -- filter against busy slots + facility snapshot. Each row is a
  -- candidate (opponent, facility, slot_start) triplet.
  -- [FIX #2] Reuse the precomputed caller_opp_overlap rows instead of
  -- re-joining caller_avail to player_availability per opponent.
  date_window AS (
    SELECT generate_series(0, 6) AS day_offset
  ),
  candidate_slots AS (
    SELECT
      r.opp_id,
      r.opp_first_name, r.opp_last_name, r.opp_avatar,
      r.opp_rep_public, r.opp_rep_score, r.opp_rep_tier, r.opp_rep_events,
      r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
      r.opp_match_type, r.opp_match_duration,
      r.fac_id, r.fac_name, r.fac_address, r.fac_city, r.fac_timezone,
      r.player_compat, r.fac_affinity, r.opp_score_history,
      ov.day AS slot_day,
      ov.hour_of_day AS slot_hour,
      ((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset) AS slot_date,
      ((((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset)
         + (LPAD(ov.hour_of_day::text, 2, '0') || ':00:00')::time)
       AT TIME ZONE COALESCE(r.fac_timezone, 'UTC')) AS slot_start
    FROM ranked_suggestions r
    CROSS JOIN date_window dw
    JOIN caller_opp_overlap ov ON ov.opp_id = r.opp_id
    -- Weekday of the generated date must equal the overlap cell's day.
    WHERE LOWER(TO_CHAR((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset, 'FMday'))
          = ov.day::text
  ),
  filtered_slots AS (
    SELECT
      cs.*,
      cs.slot_start + INTERVAL '1 hour' AS slot_end
    FROM candidate_slots cs
    WHERE cs.slot_start > v_now
      -- Snapshot filter — only when facility has been refreshed at least
      -- once AND the slot is within the 3-day snapshot horizon.
      AND (
        NOT EXISTS (SELECT 1 FROM facility_refresh_log frl WHERE frl.facility_id = cs.fac_id)
        OR cs.slot_start > v_now + INTERVAL '3 days'
        OR EXISTS (
          SELECT 1 FROM facility_availability_snapshot fas
           WHERE fas.facility_id  = cs.fac_id
             AND fas.is_available = TRUE
             AND fas.slot_start   = cs.slot_start
        )
      )
      -- Busy-slot conflict for caller + opponent: any active participant row
      -- on a non-cancelled match whose [start,end) overlaps the candidate
      -- 1-hour window on the same calendar date.
      AND NOT EXISTS (
        SELECT 1
          FROM match_participant bmp
          JOIN match bm ON bm.id = bmp.match_id
         WHERE bmp.player_id IN (p_caller_id, cs.opp_id)
           AND bmp.status IN ('joined','requested','pending','waitlisted')
           AND bm.cancelled_at IS NULL
           AND bm.match_date = cs.slot_date
           AND (bm.start_time, bm.end_time) OVERLAPS
               ((LPAD(cs.slot_hour::text, 2, '0') || ':00:00')::time,
                (LPAD((cs.slot_hour + 1)::text, 2, '0') || ':00:00')::time)
      )
  ),

  -- Per-opponent slot counts for actionability boost (caps at 0.1).
  slots_with_counts AS (
    SELECT
      fs.*,
      COUNT(*) OVER (PARTITION BY fs.opp_id) AS opp_slot_count
    FROM filtered_slots fs
  ),

  -- Per-slot score = player_compat (RPC base) + actionability + urgency + jitter.
  -- Mirrors suggestionService.ts:638-644.
  scored_slots AS (
    SELECT
      sc.*,
      (sc.player_compat
       + LEAST(0.10::numeric, GREATEST(0::numeric, (sc.opp_slot_count - 1)::numeric * 0.012))
       + (CASE
            -- Urgency curve matches urgencyBoostForDate in suggestionService.ts.
            -- "Today" is the facility-local date so the bucket matches user
            -- expectation across timezone boundaries.
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) <= 1 THEN 0.05
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) = 2  THEN 0.03
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) = 3  THEN 0.01
            ELSE 0.0
          END)
       + ((random() - 0.5) * 0.06)
      )::DECIMAL(8,4) AS slot_score
    FROM slots_with_counts sc
  ),

  -- Pick the best slot per opponent (mirrors pickTopGlobal's per-opponent
  -- dedup). DISTINCT ON keeps the first row per opp_id under the ORDER BY.
  best_slot_per_opponent AS (
    SELECT DISTINCT ON (ss.opp_id)
      ss.*
    FROM scored_slots ss
    ORDER BY ss.opp_id, ss.slot_score DESC
  ),

  -- Cross-pool dedup: drop suggestions for opponents whose match already
  -- won a slot in the match pool (justForYouComposer.ts:200-204).
  match_creator_ids AS (
    SELECT DISTINCT creator_id FROM scored_matches
  ),
  deduped_suggestions AS (
    SELECT bs.*
    FROM best_slot_per_opponent bs
    WHERE bs.opp_id NOT IN (SELECT creator_id FROM match_creator_ids)
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- JSONB PAYLOAD BUILDERS
  -- ═══════════════════════════════════════════════════════════════════

  -- Build full MatchWithDetails JSONB for each match — sport, facility,
  -- court, min_rating_score, created_by_player + profile + reputation +
  -- sport rating, participants[] with the same chain, result + sets +
  -- confirmations. Mirrors the embedded select in getMatchWithDetails.
  match_payloads AS (
    SELECT
      sm.m_id,
      sm.final_score AS score,
      sm.player_compat,
      sm.fac_affinity,
      sm.pair_score_history,
      to_jsonb(m.*)
        || jsonb_build_object(
          'distance_meters', sm.m_distance_meters,
          'player_compatibility', sm.player_compat,
          'facility_affinity', sm.fac_affinity,
          'score_history', sm.pair_score_history,
          'sport', to_jsonb(sp.*),
          'facility', CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f.*) END,
          'court', CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c.*) END,
          'min_rating_score', CASE WHEN mrs.id IS NULL THEN NULL ELSE to_jsonb(mrs.*) END,
          'created_by_player', (
            SELECT jsonb_build_object(
              'id', cp.id,
              'gender', cp.gender,
              'playing_hand', cp.playing_hand,
              'max_travel_distance', cp.max_travel_distance,
              'notification_match_requests', cp.notification_match_requests,
              'notification_messages', cp.notification_messages,
              'notification_reminders', cp.notification_reminders,
              'privacy_show_age', cp.privacy_show_age,
              'privacy_show_location', cp.privacy_show_location,
              'privacy_show_stats', cp.privacy_show_stats,
              'profile', to_jsonb(cprof.*),
              'player_reputation', CASE WHEN crep.player_id IS NULL THEN NULL
                                        ELSE jsonb_build_object(
                                          'reputation_score', crep.reputation_score,
                                          'total_events', crep.total_events
                                        ) END,
              'sportRatingLabel', cer.rating_label,
              'sportRatingValue', cer.rating_value,
              'sportCertificationStatus', cer.badge_status
            )
            FROM player cp
            LEFT JOIN profile cprof ON cprof.id = cp.id
            LEFT JOIN player_reputation crep ON crep.player_id = cp.id
            LEFT JOIN effective_rating cer ON cer.player_id = cp.id
            WHERE cp.id = m.created_by
          ),
          'participants', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', mp.id,
                'match_id', mp.match_id,
                'player_id', mp.player_id,
                'status', mp.status,
                'is_host', mp.is_host,
                'score', mp.score,
                'team_number', mp.team_number,
                'feedback_completed', mp.feedback_completed,
                'has_paid', mp.has_paid,
                'payment_intent_id', mp.payment_intent_id,
                'checked_in_at', mp.checked_in_at,
                'joined_at', mp.joined_at,
                'created_at', mp.created_at,
                'updated_at', mp.updated_at,
                'player', jsonb_build_object(
                  'id', pp.id,
                  'gender', pp.gender,
                  'playing_hand', pp.playing_hand,
                  'max_travel_distance', pp.max_travel_distance,
                  'notification_match_requests', pp.notification_match_requests,
                  'notification_messages', pp.notification_messages,
                  'notification_reminders', pp.notification_reminders,
                  'privacy_show_age', pp.privacy_show_age,
                  'privacy_show_location', pp.privacy_show_location,
                  'privacy_show_stats', pp.privacy_show_stats,
                  'profile', to_jsonb(pprof.*),
                  'player_reputation', CASE WHEN prep2.player_id IS NULL THEN NULL
                                            ELSE jsonb_build_object(
                                              'reputation_score', prep2.reputation_score,
                                              'total_events', prep2.total_events
                                            ) END,
                  'sportRatingLabel', per.rating_label,
                  'sportRatingValue', per.rating_value,
                  'sportCertificationStatus', per.badge_status
                )
              )
            )
            FROM match_participant mp
            LEFT JOIN player pp ON pp.id = mp.player_id
            LEFT JOIN profile pprof ON pprof.id = mp.player_id
            LEFT JOIN player_reputation prep2 ON prep2.player_id = mp.player_id
            LEFT JOIN effective_rating per ON per.player_id = mp.player_id
            WHERE mp.match_id = m.id
          ), '[]'::jsonb),
          'result', (
            SELECT jsonb_build_object(
              'id', mr.id,
              'winning_team', mr.winning_team,
              'team1_score', mr.team1_score,
              'team2_score', mr.team2_score,
              'is_verified', mr.is_verified,
              'disputed', mr.disputed,
              'submitted_by', mr.submitted_by,
              'confirmation_deadline', mr.confirmation_deadline,
              'confirmed_by', mr.confirmed_by,
              'verified_at', mr.verified_at,
              'created_at', mr.created_at,
              'updated_at', mr.updated_at,
              'rebuttal_team1_score', mr.rebuttal_team1_score,
              'rebuttal_team2_score', mr.rebuttal_team2_score,
              'rebuttal_winning_team', mr.rebuttal_winning_team,
              'rebuttal_sets', mr.rebuttal_sets,
              'rebuttal_submitted_by', mr.rebuttal_submitted_by,
              'rebuttal_submitted_at', mr.rebuttal_submitted_at,
              'rebuttal_deadline', mr.rebuttal_deadline,
              'sets', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'set_number', ms.set_number,
                  'team1_score', ms.team1_score,
                  'team2_score', ms.team2_score
                ) ORDER BY ms.set_number)
                FROM match_set ms WHERE ms.match_result_id = mr.id
              ), '[]'::jsonb),
              'confirmations', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'player_id', sc.player_id,
                  'action', sc.action
                ))
                FROM score_confirmation sc WHERE sc.match_result_id = mr.id
              ), '[]'::jsonb)
            )
            FROM match_result mr WHERE mr.match_id = m.id
            LIMIT 1
          )
        ) AS payload
    FROM scored_matches sm
    JOIN match m              ON m.id   = sm.m_id
    LEFT JOIN sport sp        ON sp.id  = m.sport_id
    LEFT JOIN facility f      ON f.id   = m.facility_id
    LEFT JOIN court c         ON c.id   = m.court_id
    LEFT JOIN rating_score mrs ON mrs.id = m.min_rating_score_id
  ),

  suggestion_payloads AS (
    SELECT
      ds.opp_id,
      ds.slot_score AS score,
      ds.player_compat,
      ds.fac_affinity,
      ds.opp_score_history,
      jsonb_build_object(
        'opponentId', ds.opp_id,
        'opponentFirstName', ds.opp_first_name,
        'opponentLastName', ds.opp_last_name,
        'opponentAvatar', ds.opp_avatar,
        'opponentReputationScore', CASE WHEN ds.opp_rep_public THEN ds.opp_rep_score ELSE NULL END,
        'opponentReputationTier', CASE WHEN ds.opp_rep_events < 5 THEN 'unknown'
                                       ELSE ds.opp_rep_tier::text END,
        'opponentRatingScoreValue', ds.opp_rating_value,
        'opponentRatingLabel', ds.opp_rating_label,
        'opponentBadgeStatus', ds.opp_badge_status,
        'matchType', ds.opp_match_type,
        'matchDuration', ds.opp_match_duration,
        'facility', jsonb_build_object(
          'facilityId', ds.fac_id,
          'facilityName', ds.fac_name,
          'facilityAddress', ds.fac_address,
          'facilityCity', ds.fac_city,
          'facilityAffinity', ds.fac_affinity,
          'hasAvailabilitySource', FALSE
        ),
        'slot', jsonb_build_object(
          'datetime', ds.slot_start,
          'endDatetime', ds.slot_end,
          'bookingUrl', NULL
        ),
        'score', ds.slot_score,
        'playerCompatibility', ds.player_compat,
        'scoreHistory', ds.opp_score_history
      ) AS payload
    FROM deduped_suggestions ds
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- FINAL MERGE — UNION ALL, ORDER BY score DESC, LIMIT p_limit
  -- ═══════════════════════════════════════════════════════════════════
  merged AS (
    SELECT
      'match'::text                    AS kind,
      mp.score                         AS score,
      mp.payload                       AS match_payload,
      NULL::jsonb                      AS suggestion_payload,
      mp.player_compat                 AS player_compatibility,
      mp.fac_affinity                  AS facility_affinity,
      mp.pair_score_history            AS score_history
    FROM match_payloads mp
    UNION ALL
    SELECT
      'suggestion'::text               AS kind,
      sp.score                         AS score,
      NULL::jsonb                      AS match_payload,
      sp.payload                       AS suggestion_payload,
      sp.player_compat                 AS player_compatibility,
      sp.fac_affinity                  AS facility_affinity,
      sp.opp_score_history             AS score_history
    FROM suggestion_payloads sp
  )

  SELECT
    merged.kind,
    merged.score::numeric,
    merged.match_payload,
    merged.suggestion_payload,
    merged.player_compatibility::numeric,
    merged.facility_affinity::numeric,
    merged.score_history::numeric
  FROM merged
  ORDER BY merged.score DESC
  LIMIT p_limit;

END;
$function$;

CREATE OR REPLACE FUNCTION public.get_match_suggestions_anon(p_sport_id uuid, p_lat double precision, p_lng double precision, p_max_distance_km integer DEFAULT 25, p_limit integer DEFAULT 50)
 RETURNS TABLE(opponent_id uuid, opponent_first_name text, opponent_last_name text, opponent_avatar text, opponent_reputation_score numeric, opponent_reputation_tier reputation_tier, opponent_rating_value double precision, opponent_rating_label text, opponent_badge_status badge_status_enum, facility_id uuid, facility_name text, facility_address text, facility_city text, facility_data_provider_id uuid, facility_provider_type text, facility_external_id text, facility_booking_url_tpl text, facility_timezone text, overlapping_days_periods jsonb, match_type match_type_enum, match_duration match_duration_enum, player_compatibility numeric, facility_affinity numeric, matchup_score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET work_mem TO '32MB'
 SET plan_cache_mode TO 'force_generic_plan'
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
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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

CREATE OR REPLACE FUNCTION public.get_match_suggestions_scored(p_player_id uuid, p_sport_id uuid, p_limit integer DEFAULT 50, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS TABLE(opponent_id uuid, opponent_first_name text, opponent_last_name text, opponent_avatar text, opponent_reputation_score numeric, opponent_reputation_tier reputation_tier, opponent_rating_value double precision, opponent_rating_label text, opponent_badge_status badge_status_enum, facility_id uuid, facility_name text, facility_address text, facility_city text, facility_data_provider_id uuid, facility_provider_type text, facility_external_id text, facility_booking_url_tpl text, facility_timezone text, overlapping_days_periods jsonb, match_type match_type_enum, match_duration match_duration_enum, player_compatibility numeric, facility_affinity numeric, matchup_score numeric, score_history numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET work_mem TO '32MB'
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
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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

  -- Caller↔opponent availability overlap, computed ONCE. One pass of
  -- caller_avail ⋈ player_availability grouped by player. Replaces the
  -- per-opponent EXISTS filter (Memoized index probes) AND the per-opponent
  -- score_overlap subquery in `opponents`.
  opp_overlap AS MATERIALIZED (
    SELECT oa.player_id AS opp_id, COUNT(*)::DECIMAL AS overlap_cnt
      FROM caller_avail ca
      JOIN player_availability oa
        ON oa.day         = ca.day
       AND oa.hour_of_day = ca.hour_of_day
       AND oa.is_active   = TRUE
     GROUP BY oa.player_id
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

      -- Hourly re-tune: saturate at 12 overlapping (day, hour) cells. Read
      -- from the precomputed opp_overlap CTE instead of a per-row subquery.
      LEAST(ov.overlap_cnt / 12.0, 1.0) AS score_overlap,

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
    -- Inner join enforces the availability-overlap requirement (presence in
    -- opp_overlap ⟺ overlap_cnt >= 1), replacing the old EXISTS filter.
    JOIN opp_overlap ov ON ov.opp_id = ps.player_id
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
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 500
  ),

  -- The caller's favorited facilities for this sport — the only facilities
  -- `matchups` can emit (it inner-joins caller-favorited cpff). Used to scope
  -- the bookability snapshot scan to a single grouped pass.
  caller_fac AS MATERIALIZED (
    SELECT cpff.facility_id AS fac_id
    FROM player_favorite_facility cpff
    WHERE cpff.player_id = p_player_id
      AND cpff.sport_id  = p_sport_id
  ),

  facility_bookable AS MATERIALIZED (
    SELECT fas.facility_id AS fac_id, COUNT(*)::numeric AS avail_cnt
    FROM public.facility_availability_snapshot fas
    WHERE fas.facility_id IN (SELECT fac_id FROM caller_fac)
      AND fas.is_available = TRUE
      AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
    GROUP BY fas.facility_id
  ),

  facility_refreshed AS MATERIALIZED (
    SELECT DISTINCT frl.facility_id AS fac_id
    FROM public.facility_refresh_log frl
    WHERE frl.facility_id IN (SELECT fac_id FROM caller_fac)
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

      -- Bookability from the precomputed per-facility CTEs (arithmetic
      -- unchanged vs the old per-row correlated subquery).
      CASE
        WHEN COALESCE(f.data_provider_id, org.data_provider_id) IS NULL THEN 0.5
        WHEN fr.fac_id IS NULL THEN 0.5
        ELSE LEAST(1.0, COALESCE(fb.avail_cnt, 0) / 30.0)
      END AS score_bookability,

      (
        -- The matchups cpff join already guarantees the caller favorited this
        -- facility for this sport, so the old EXISTS(...) is always true → 0.30.
        0.30
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000)))
      ) AS score_facility_geo

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    -- Require the caller to ALSO have favorited this facility for this sport.
    JOIN player_favorite_facility cpff
      ON cpff.player_id   = p_player_id
     AND cpff.sport_id    = p_sport_id
     AND cpff.facility_id = pff.facility_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
    LEFT JOIN facility_bookable fb ON fb.fac_id = f.id
    LEFT JOIN facility_refreshed fr ON fr.fac_id = f.id
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

CREATE OR REPLACE FUNCTION public.get_nearby_public_matches(p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text DEFAULT NULL::text, p_limit integer DEFAULT 5)
 RETURNS TABLE(score numeric, match_payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET jit TO 'off'
AS $function$
DECLARE
  v_point extensions.geography;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
  IF p_sport_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  v_point :=
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  RETURN QUERY
  WITH
  -- ── Per-player effective rating for this sport (cert > self > disputed;
  --    recency tiebreak). Caller-independent — needed only to fill the
  --    sportRating* fields in the JSONB payload. ──────────────────────────
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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

  -- ── Nearby joinable public matches (mirrors search_matches_nearby's
  --    visibility/location/gender filter; future start with a 30-min lead
  --    to match isMatchStillJoinable's default). ─────────────────────────
  candidate_matches AS (
    SELECT
      m.id         AS m_id,
      m.match_date AS m_date,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
            )::extensions.geography
          ELSE NULL
        END,
        v_point
      ) AS m_distance_meters,
      (
        (CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END)
        - COALESCE((
            SELECT COUNT(*) FROM match_participant pp
             WHERE pp.match_id = m.id AND pp.status = 'joined'
          ), 0)
      ) AS spots_left
    FROM match m
    LEFT JOIN facility f ON f.id = m.facility_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp)
          ELSE
            (m.match_date + m.start_time) AT TIME ZONE 'UTC'
        END
      ) > v_now + INTERVAL '30 minutes'
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
          )::extensions.geography
        END,
        v_point,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
  ),

  -- ── Rank + cap to p_limit BEFORE building the (expensive) JSONB. ────────
  top_matches AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      (
          0.45 * GREATEST(0::numeric,
                   1.0 - cm.m_distance_meters::numeric / NULLIF(p_max_distance_km * 1000, 0))
        + 0.35 * (CASE
                    WHEN cm.m_date <= CURRENT_DATE     THEN 1.00
                    WHEN cm.m_date  = CURRENT_DATE + 1 THEN 0.85
                    WHEN cm.m_date  = CURRENT_DATE + 2 THEN 0.70
                    WHEN cm.m_date  = CURRENT_DATE + 3 THEN 0.55
                    WHEN cm.m_date <= CURRENT_DATE + 7 THEN 0.40
                    ELSE 0.25
                  END)
        + 0.20 * (CASE
                    WHEN cm.spots_left <= 0 THEN 0.10
                    WHEN cm.spots_left  = 1 THEN 1.00
                    WHEN cm.spots_left  = 2 THEN 0.80
                    WHEN cm.spots_left  = 3 THEN 0.60
                    ELSE 0.40
                  END)
      )::DECIMAL(8,4) AS final_score
    FROM candidate_matches cm
    ORDER BY final_score DESC, cm.m_distance_meters ASC NULLS LAST
    LIMIT p_limit
  ),

  -- ── Full MatchWithDetails JSONB (byte-shape mirror of get_just_for_you's
  --    match_payloads builder, which mirrors getMatchWithDetails). The
  --    caller-scoped score fields are null in anon mode. ────────────────────
  match_payloads AS (
    SELECT
      tm.final_score AS score,
      to_jsonb(m.*)
        || jsonb_build_object(
          'distance_meters', tm.m_distance_meters,
          'player_compatibility', NULL::numeric,
          'facility_affinity', NULL::numeric,
          'score_history', NULL::numeric,
          'sport', to_jsonb(sp.*),
          'facility', CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f.*) END,
          'court', CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c.*) END,
          'min_rating_score', CASE WHEN mrs.id IS NULL THEN NULL ELSE to_jsonb(mrs.*) END,
          'created_by_player', (
            SELECT jsonb_build_object(
              'id', cp.id,
              'gender', cp.gender,
              'playing_hand', cp.playing_hand,
              'max_travel_distance', cp.max_travel_distance,
              'notification_match_requests', cp.notification_match_requests,
              'notification_messages', cp.notification_messages,
              'notification_reminders', cp.notification_reminders,
              'privacy_show_age', cp.privacy_show_age,
              'privacy_show_location', cp.privacy_show_location,
              'privacy_show_stats', cp.privacy_show_stats,
              'profile', to_jsonb(cprof.*),
              'player_reputation', CASE WHEN crep.player_id IS NULL THEN NULL
                                        ELSE jsonb_build_object(
                                          'reputation_score', crep.reputation_score,
                                          'total_events', crep.total_events
                                        ) END,
              'sportRatingLabel', cer.rating_label,
              'sportRatingValue', cer.rating_value,
              'sportCertificationStatus', cer.badge_status
            )
            FROM player cp
            LEFT JOIN profile cprof ON cprof.id = cp.id
            LEFT JOIN player_reputation crep ON crep.player_id = cp.id
            LEFT JOIN effective_rating cer ON cer.player_id = cp.id
            WHERE cp.id = m.created_by
          ),
          'participants', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', mp.id,
                'match_id', mp.match_id,
                'player_id', mp.player_id,
                'status', mp.status,
                'is_host', mp.is_host,
                'score', mp.score,
                'team_number', mp.team_number,
                'feedback_completed', mp.feedback_completed,
                'has_paid', mp.has_paid,
                'payment_intent_id', mp.payment_intent_id,
                'checked_in_at', mp.checked_in_at,
                'joined_at', mp.joined_at,
                'created_at', mp.created_at,
                'updated_at', mp.updated_at,
                'player', jsonb_build_object(
                  'id', pp.id,
                  'gender', pp.gender,
                  'playing_hand', pp.playing_hand,
                  'max_travel_distance', pp.max_travel_distance,
                  'notification_match_requests', pp.notification_match_requests,
                  'notification_messages', pp.notification_messages,
                  'notification_reminders', pp.notification_reminders,
                  'privacy_show_age', pp.privacy_show_age,
                  'privacy_show_location', pp.privacy_show_location,
                  'privacy_show_stats', pp.privacy_show_stats,
                  'profile', to_jsonb(pprof.*),
                  'player_reputation', CASE WHEN prep2.player_id IS NULL THEN NULL
                                            ELSE jsonb_build_object(
                                              'reputation_score', prep2.reputation_score,
                                              'total_events', prep2.total_events
                                            ) END,
                  'sportRatingLabel', per.rating_label,
                  'sportRatingValue', per.rating_value,
                  'sportCertificationStatus', per.badge_status
                )
              )
            )
            FROM match_participant mp
            LEFT JOIN player pp ON pp.id = mp.player_id
            LEFT JOIN profile pprof ON pprof.id = mp.player_id
            LEFT JOIN player_reputation prep2 ON prep2.player_id = mp.player_id
            LEFT JOIN effective_rating per ON per.player_id = mp.player_id
            WHERE mp.match_id = m.id
          ), '[]'::jsonb),
          'result', (
            SELECT jsonb_build_object(
              'id', mr.id,
              'winning_team', mr.winning_team,
              'team1_score', mr.team1_score,
              'team2_score', mr.team2_score,
              'is_verified', mr.is_verified,
              'disputed', mr.disputed,
              'submitted_by', mr.submitted_by,
              'confirmation_deadline', mr.confirmation_deadline,
              'confirmed_by', mr.confirmed_by,
              'verified_at', mr.verified_at,
              'created_at', mr.created_at,
              'updated_at', mr.updated_at,
              'rebuttal_team1_score', mr.rebuttal_team1_score,
              'rebuttal_team2_score', mr.rebuttal_team2_score,
              'rebuttal_winning_team', mr.rebuttal_winning_team,
              'rebuttal_sets', mr.rebuttal_sets,
              'rebuttal_submitted_by', mr.rebuttal_submitted_by,
              'rebuttal_submitted_at', mr.rebuttal_submitted_at,
              'rebuttal_deadline', mr.rebuttal_deadline,
              'sets', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'set_number', ms.set_number,
                  'team1_score', ms.team1_score,
                  'team2_score', ms.team2_score
                ) ORDER BY ms.set_number)
                FROM match_set ms WHERE ms.match_result_id = mr.id
              ), '[]'::jsonb),
              'confirmations', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'player_id', sc.player_id,
                  'action', sc.action
                ))
                FROM score_confirmation sc WHERE sc.match_result_id = mr.id
              ), '[]'::jsonb)
            )
            FROM match_result mr WHERE mr.match_id = m.id
            LIMIT 1
          )
        ) AS payload
    FROM top_matches tm
    JOIN match m               ON m.id   = tm.m_id
    LEFT JOIN sport sp         ON sp.id  = m.sport_id
    LEFT JOIN facility f       ON f.id   = m.facility_id
    LEFT JOIN court c          ON c.id   = m.court_id
    LEFT JOIN rating_score mrs ON mrs.id = m.min_rating_score_id
  )

  SELECT mp.score::numeric, mp.payload
  FROM match_payloads mp
  ORDER BY mp.score DESC
  LIMIT p_limit;

END;
$function$;

CREATE OR REPLACE FUNCTION public.get_upcoming_matches_scored(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(match_id uuid, distance_meters double precision, player_compatibility numeric, facility_affinity numeric, score_history numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET work_mem TO '32MB'
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
  v_now                    TIMESTAMPTZ := NOW();
BEGIN
  -- Caller location + travel cap + sport preferences
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_caller_id;

  -- Location override from RPC params (e.g. user querying a different area
  -- than their stored home, or GPS-derived position)
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  -- Caller rating + badge: pick the best record using the same precedence as
  -- get_match_suggestions_scored (certified-or-equivalent > self-declared >
  -- disputed; most-recently-assigned breaks ties).
  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_rating_score prs
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
    JOIN rating_system  rsys ON rsys.id = rs.rating_system_id AND rsys.sport_id = p_sport_id
   WHERE prs.player_id = p_caller_id
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
  -- ── Per-player effective rating for this sport ─────────────────────
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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

  -- ── Caller's hourly availability slots ─────────────────────────────
  caller_avail AS (
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_caller_id
       AND ca.is_active  = TRUE
  ),

  -- ── Blocked players (either direction) ─────────────────────────────
  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_caller_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_caller_id
  ),

  -- ── Creator responsiveness (90-day window, same formula as the
  --    suggestion RPC). For matches, this signals whether the creator
  --    is likely to respond to a join request. ────────────────────────
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= v_now - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < v_now - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  -- ── Caller↔opponent history components (identical to suggestion RPC,
  --    keyed on opp_id which here will be the match creator) ──────────
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
    WHERE mf.reviewer_id = p_caller_id
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
     AND other.player_id <> p_caller_id
     AND other.status = 'joined'
    WHERE me.player_id = p_caller_id
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
           AND pf2.favorite_player_id = p_caller_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_caller_id
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
                           AND nm2.player_id <> p_caller_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_caller_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),
  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= v_now - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_caller_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_caller_id
    GROUP BY cp2.player_id
  ),
  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_caller_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),
  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_caller_id
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

  -- ── Candidate matches with eligibility filters + resolved location ──
  candidate_matches AS (
    SELECT
      m.id                        AS m_id,
      m.created_by                AS creator_id,
      m.facility_id               AS m_facility_id,
      m.location_type             AS m_location_type,
      m.match_date                AS m_date,
      m.start_time                AS m_start_time,
      m.end_time                  AS m_end_time,
      m.duration                  AS m_duration,
      m.player_expectation        AS m_match_type,
      -- Resolved match location point (facility or custom).
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
        WHEN m.location_type = 'custom'
          AND m.custom_latitude IS NOT NULL
          AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        ELSE NULL
      END                          AS m_location,
      f.location                   AS facility_location,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          ELSE NULL
        END,
        v_caller_location
      )                            AS m_distance_meters
    FROM match m
    LEFT JOIN facility f      ON f.id      = m.facility_id
    LEFT JOIN rating_score mr ON mr.id     = m.min_rating_score_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND m.created_by <> p_caller_id
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id  = m.id
           AND mp.player_id = p_caller_id
           AND mp.status IN ('joined', 'requested', 'waitlisted')
      )
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp) > v_now
          ELSE
            (m.match_date + m.start_time)::timestamp > (v_now AT TIME ZONE 'UTC')::timestamp
        END
      )
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        END,
        v_caller_location,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      AND m.created_by NOT IN (SELECT pid FROM blocked_ids)
      AND (
        m.min_rating_score_id IS NULL
        OR v_caller_rating_value IS NULL
        OR v_caller_rating_value >= mr.value - 0.5
      )
  ),

  -- ── Per-match scoring (creator plays the role of "opponent") ────────
  scored AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      cm.creator_id,
      er.badge_status AS creator_badge_status,

      -- w1: Match-type alignment (caller pref ↔ match.match_type — the
      -- type the creator chose for this match, which may differ from
      -- the creator's general preference). NULL match_type → neutral.
      CASE
        WHEN cm.m_match_type IS NULL THEN 0.5
        WHEN v_caller_match_type = cm.m_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR cm.m_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,

      -- w2: Skill proximity (caller ↔ creator) × rating-badge confidence.
      -- Reuses the suggestion RPC's matrix verbatim.
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

      -- w3: Duration alignment (caller pref ↔ match.duration — the
      -- concrete duration on the match, not the creator's general pref).
      CASE
        WHEN v_caller_match_duration IS NULL OR cm.m_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = cm.m_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,

      -- w4: Availability FIT — % of the match's hour-range covered by the
      -- caller's active (day_of_week, hour_of_day) rows. Different shape
      -- from the suggestion RPC's *density* signal: density is meaningful
      -- when *generating* slot candidates; here the slot is fixed.
      CASE
        WHEN cm.m_start_time IS NULL OR cm.m_end_time IS NULL THEN 0.5
        ELSE COALESCE((
          SELECT
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM caller_avail ca
               WHERE ca.day::TEXT = LOWER(TO_CHAR(cm.m_date, 'FMday'))
                 AND ca.hour_of_day = h.hr::smallint
            ) THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0)
          FROM generate_series(
            EXTRACT(HOUR FROM cm.m_start_time)::int,
            GREATEST(
              EXTRACT(HOUR FROM cm.m_start_time)::int,
              EXTRACT(HOUR FROM cm.m_end_time)::int - 1
            )
          ) AS h(hr)
        ), 0.0)
      END AS score_availability_fit,

      -- w5: Creator reputation. Gated by is_public (which requires
      -- matches_completed ≥ 3).
      CASE
        WHEN COALESCE(rep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(rep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

      -- w6: Creator responsiveness (90-day window).
      COALESCE(
        CASE
          WHEN rs.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (rs.responded::NUMERIC / NULLIF(rs.received, 0))
            + 0.3 * (CASE
                       WHEN rs.responded > 0
                       THEN rs.accepted::NUMERIC / rs.responded
                       ELSE 0.5
                     END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,

      -- w7: Creator activity (existing helper).
      public.player_activity_score(cm.creator_id)::DECIMAL(6,4) AS score_activity,

      -- Caller↔creator history (signed ±0.5).
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS pair_score_history,

      -- Facility affinity components — capped via final LEAST().
      -- Shared favorite bonus (only meaningful for facility-located matches).
      CASE
        WHEN cm.m_facility_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = cm.m_facility_id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30
        ELSE 0.0
      END AS fac_shared_fav_bonus,

      -- Distance decay to caller's home (works for facility + custom).
      CASE
        WHEN cm.m_location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.m_location, v_caller_location)
                       / (COALESCE(v_caller_max_distance, 25) * 1000)))
      END AS fac_dist_caller,

      -- Distance decay to creator's home (only sensible for facility matches:
      -- a custom location doesn't tell us about the creator's convenience).
      CASE
        WHEN cm.m_facility_id IS NULL
          OR cm.facility_location IS NULL
          OR creator_player.location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.facility_location, creator_player.location)
                       / (COALESCE(creator_player.max_travel_distance, 25) * 1000)))
      END AS fac_dist_creator

    FROM candidate_matches cm
    JOIN player creator_player      ON creator_player.id = cm.creator_id
    LEFT JOIN effective_rating er   ON er.player_id      = cm.creator_id
    LEFT JOIN player_reputation rep ON rep.player_id     = cm.creator_id
    LEFT JOIN responsiveness rs     ON rs.player_id      = cm.creator_id
    LEFT JOIN history h             ON h.opp_id          = cm.creator_id
  )

  SELECT
    s.m_id                  AS match_id,
    s.m_distance_meters     AS distance_meters,
    -- player_compatibility = clamp(base + 0.5×score_history − disputed_penalty, 0, 1)
    -- Weights (sum to 1.0): match_type 0.18, skill 0.18, duration 0.05,
    -- availability_fit 0.27, reputation 0.05, responsiveness 0.17, activity 0.10.
    -- Tilted relative to the suggestion RPC: +0.05 to availability (concrete
    -- fit beats generic density on this surface) and −0.05 from reputation.
    LEAST(1.0, GREATEST(0.0,
      ( 0.18 * s.score_match_type
      + 0.18 * s.score_skill
      + 0.05 * s.score_duration
      + 0.27 * s.score_availability_fit
      + 0.05 * s.score_reputation
      + 0.17 * s.score_responsiveness
      + 0.10 * s.score_activity
      )
      + 0.5 * s.pair_score_history
      - (CASE WHEN s.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
    ))::DECIMAL(6,4) AS player_compatibility,
    -- facility_affinity ∈ [0, 1], capped.
    LEAST(1.0,
      s.fac_shared_fav_bonus + s.fac_dist_caller + s.fac_dist_creator
    )::DECIMAL(6,4) AS facility_affinity,
    s.pair_score_history    AS score_history
  FROM scored s
  ORDER BY
    -- Ranking score: 0.70 × player_compat + 0.30 × facility_affinity
    -- (mirror suggestion RPC's outer composition).
    (
      0.70 * LEAST(1.0, GREATEST(0.0,
        ( 0.18 * s.score_match_type
        + 0.18 * s.score_skill
        + 0.05 * s.score_duration
        + 0.27 * s.score_availability_fit
        + 0.05 * s.score_reputation
        + 0.17 * s.score_responsiveness
        + 0.10 * s.score_activity
        )
        + 0.5 * s.pair_score_history
        - (CASE WHEN s.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))
    + 0.30 * LEAST(1.0, s.fac_shared_fav_bonus + s.fac_dist_caller + s.fac_dist_creator)
    ) DESC
  LIMIT p_limit;

END;
$function$;

CREATE OR REPLACE FUNCTION public.search_players_nearby(p_sport_id uuid, p_current_user_id uuid DEFAULT NULL::uuid, p_search_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_gender text DEFAULT NULL::text, p_min_skill_value numeric DEFAULT NULL::numeric, p_min_travel_distance_km integer DEFAULT NULL::integer, p_availability text DEFAULT NULL::text, p_day text DEFAULT NULL::text, p_play_style text DEFAULT NULL::text, p_favorite_player_ids uuid[] DEFAULT NULL::uuid[], p_blocked_player_ids uuid[] DEFAULT NULL::uuid[], p_favorites_only boolean DEFAULT false, p_blocked_only boolean DEFAULT false, p_exclude_player_ids uuid[] DEFAULT NULL::uuid[], p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_rating_score_ids uuid[] DEFAULT NULL::uuid[], p_reputation_tier text DEFAULT NULL::text, p_certified_only boolean DEFAULT false, p_min_hour smallint DEFAULT NULL::smallint, p_max_hour smallint DEFAULT NULL::smallint)
 RETURNS TABLE(id uuid, first_name text, last_name text, display_name text, profile_picture_url text, city text, gender text, rating_label text, rating_value double precision, rating_is_certified boolean, rating_badge_status text, latitude double precision, longitude double precision, distance_meters double precision, total_count bigint, reputation_tier text, reputation_score double precision, reputation_is_public boolean, last_seen_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    LEFT JOIN player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = p_sport_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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
    CASE WHEN p_sort_by = 'recently_active' THEN f.last_seen_at END DESC NULLS LAST,
    f.id ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates(p_match_id uuid, p_max integer DEFAULT 3, p_weekly_cap integer DEFAULT 5, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
      LEFT JOIN public.player_sport eps ON eps.player_id = prs.player_id AND eps.sport_id = m.sport_id
     ORDER BY prs.player_id,
       (eps.active_rating_score_id IS NOT DISTINCT FROM prs.id) DESC,
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
$function$;

