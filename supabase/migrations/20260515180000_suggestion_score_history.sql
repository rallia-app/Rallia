-- =============================================================================
-- Suggestion scoring: caller↔opponent history & social signals
--
-- Adds a signed score_history component to get_match_suggestions_scored that
-- nudges player_compat up by up to +25% for established pairs with good
-- history, and down by up to -25% for pairs with soft-negative history.
--
-- Composition: player_compat = clamp(base + 0.5 × score_history, 0, 1).
-- Existing 7 content-signal weights (match_type, skill, duration, overlap,
-- reputation, responsiveness, activity) are unchanged.
--
-- Signals folded into score_history ∈ [-0.5, +0.5]:
--   + Past pair matches (recency-decayed)
--   + Caller→opp star ratings (signed: 5★ → positive, 1★ → negative)
--   + Caller favorited opp (+ mutual bonus if both directions)
--   + Shared network membership, weighted by network type
--   + Past conversation activity (any + recent-message bonus)
--   - Caller-filed player_reports (excluding admin-dismissed)
--   - Caller-filed match_reports
--   - Caller-marked no-shows
--   - Caller-marked lates
--
-- Cold-start guard: score_history = 0 when total signal events < 2. Prevents
-- a single favorite or single match from swinging the ranking.
--
-- Hard blocks (player_block either direction) remain enforced at the
-- opponent-eligibility stage — unchanged. score_history demotes; it does
-- not exclude.
--
-- Scope: auth RPC only. The anon path has no caller identity, so no
-- caller↔opp relationship to score; get_match_suggestions_anon is untouched.
-- =============================================================================

-- =============================================================================
-- 1. Missing indexes for the new caller-scoped scans
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_match_feedback_reviewer_opp
  ON public.match_feedback (reviewer_id, opponent_id);

CREATE INDEX IF NOT EXISTS idx_match_report_reporter
  ON public.match_report (reporter_id, reported_id);

CREATE INDEX IF NOT EXISTS idx_network_member_player_active
  ON public.network_member (player_id, network_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_conversation_participant_player
  ON public.conversation_participant (player_id, conversation_id);

-- =============================================================================
-- 2. Diagnostic helper — single-pair history score, mirrors the inline CTE.
--    NOT called from the suggestion RPC hot path (per the responsiveness
--    precedent: per-row PL/pgSQL calls are too slow). Exists for ad-hoc
--    inspection / debugging.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.player_history_score(
  p_caller_id   uuid,
  p_opponent_id uuid
) RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $function$
  WITH
  fb AS (
    SELECT
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
    FROM public.match_feedback mf
    JOIN public.match m ON m.id = mf.match_id
    WHERE mf.reviewer_id = p_caller_id
      AND mf.opponent_id = p_opponent_id
  ),
  pm AS (
    SELECT
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) AS pair_match_weight,
      COUNT(*) AS pair_match_count
    FROM public.match_participant me
    JOIN public.match m ON m.id = me.match_id
    JOIN public.match_participant other
      ON other.match_id = me.match_id
     AND other.player_id = p_opponent_id
     AND other.status = 'joined'
    WHERE me.player_id = p_caller_id
      AND me.status = 'joined'
      AND m.cancelled_at IS NULL
      AND m.match_date < CURRENT_DATE
  ),
  fav AS (
    SELECT
      EXISTS (
        SELECT 1 FROM public.player_favorite
         WHERE player_id = p_caller_id
           AND favorite_player_id = p_opponent_id
      ) AS caller_fav,
      EXISTS (
        SELECT 1 FROM public.player_favorite pf1
         JOIN public.player_favorite pf2
           ON pf1.player_id = pf2.favorite_player_id
          AND pf1.favorite_player_id = pf2.player_id
         WHERE pf1.player_id = p_caller_id
           AND pf1.favorite_player_id = p_opponent_id
      ) AS mutual_fav
  ),
  net AS (
    SELECT
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
    FROM public.network_member nm1
    JOIN public.network n        ON n.id = nm1.network_id
    JOIN public.network_type nt  ON nt.id = n.network_type_id
    JOIN public.network_member nm2
      ON nm2.network_id = nm1.network_id
     AND nm2.player_id = p_opponent_id
     AND nm2.status = 'active'
    WHERE nm1.player_id = p_caller_id
      AND nm1.status = 'active'
  ),
  conv AS (
    SELECT
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= NOW() - INTERVAL '30 days'
      ) AS recent_msgs
    FROM public.conversation_participant cp1
    JOIN public.conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id = p_opponent_id
    LEFT JOIN public.message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_caller_id
  ),
  prep AS (
    SELECT COUNT(*) AS rep_count
    FROM public.player_report pr
    WHERE pr.reporter_id = p_caller_id
      AND pr.reported_player_id = p_opponent_id
      AND pr.status::text <> 'dismissed'
  ),
  mrep AS (
    SELECT COUNT(*) AS mrep_count
    FROM public.match_report mr
    WHERE mr.reporter_id = p_caller_id
      AND mr.reported_id = p_opponent_id
  )
  SELECT
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
    END
  FROM fb, pm, fav, net, conv, prep, mrep;
$function$;

GRANT EXECUTE ON FUNCTION public.player_history_score(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.player_history_score IS
  'Diagnostic: per-pair caller↔opponent history score in [-0.5, +0.5]. '
  'Mirrors the inline `history` CTE in get_match_suggestions_scored. '
  'NOT called from the hot path; use the RPC output for production reads.';

-- =============================================================================
-- 3. Replace get_match_suggestions_scored with version that adds score_history
--    DROP first because we're widening the RETURNS TABLE shape (adding the
--    score_history output column); CREATE OR REPLACE can't change the
--    return type of an existing function.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_match_suggestions_scored(uuid, uuid, integer, double precision, double precision);

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
  'Auth match suggestions. player_compat = clamp(<7 content weights sum to 1.0> + 0.5 × score_history, 0, 1), where '
  'score_history ∈ [-0.5, +0.5] folds in caller↔opponent relationship signals: past matches, star ratings, favorites '
  '(incl. mutual), shared networks (weighted by type), past conversations, minus reports / no-shows / lates. '
  'Cold-start guard at <2 signal events. Hard player_block remains the only exclusion. facility_affinity unchanged.';
