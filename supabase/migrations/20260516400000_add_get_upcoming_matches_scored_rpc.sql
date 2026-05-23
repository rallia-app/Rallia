-- =============================================================================
-- RPC: get_upcoming_matches_scored
-- =============================================================================
-- Scores upcoming public matches for relevance to a caller. Mirrors
-- get_match_suggestions_scored's compatibility math (caller↔creator as the
-- relational pair), but adapted to upcoming matches:
--   • match_type / duration are scored against the match's concrete fields,
--     not the creator's general preferences
--   • availability is a FIT signal on the match's specific hour-range, not
--     the suggestion-side density across the whole week
--   • facility_affinity uses the match's location; custom-location matches
--     fall back to caller-only distance decay (creator's location is not
--     a useful signal when the match is at a non-favorited custom spot)
--   • hard eligibility filters: caller cannot be creator/participant, match
--     must be public/uncancelled/future (timezone-aware)/within radius,
--     creator not blocked, caller meets match.min_rating_score within a
--     0.5-step grace
--
-- Anon callers continue to use search_matches_nearby (which only filters,
-- doesn't score).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_upcoming_matches_scored(
  p_caller_id        uuid,
  p_sport_id         uuid,
  p_latitude         double precision,
  p_longitude        double precision,
  p_max_distance_km  double precision,
  p_user_gender      text             DEFAULT NULL,
  p_limit            integer          DEFAULT 30
)
RETURNS TABLE(
  match_id              uuid,
  distance_meters       double precision,
  player_compatibility  numeric,
  facility_affinity     numeric,
  score_history         numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

ALTER FUNCTION public.get_upcoming_matches_scored(
  uuid, uuid, double precision, double precision, double precision, text, integer
) SET work_mem = '32MB';

GRANT EXECUTE ON FUNCTION public.get_upcoming_matches_scored(
  uuid, uuid, double precision, double precision, double precision, text, integer
) TO authenticated;

COMMENT ON FUNCTION public.get_upcoming_matches_scored(
  uuid, uuid, double precision, double precision, double precision, text, integer
) IS
  'Scores upcoming public matches for a caller. Mirrors get_match_suggestions_scored compatibility math (caller-creator as the relational pair), adapted to upcoming matches: match_type/duration scored against match.match_type/match.duration; availability is a FIT signal on the match specific hour-range; facility_affinity uses match location with caller-only distance decay for custom-location matches. Hard filters: caller not creator/participant, match public/uncancelled/future/in-radius, creator not blocked, caller meets min_rating_score within 0.5-step grace.';
