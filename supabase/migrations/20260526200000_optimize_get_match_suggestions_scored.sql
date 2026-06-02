-- ════════════════════════════════════════════════════════════════════════
-- Optimize get_match_suggestions_scored — overlap-once + bookability-once
-- ════════════════════════════════════════════════════════════════════════
--
-- Sibling fix to the anon RPC (20260526190000) and get_just_for_you fixes
-- #2/#3 (20260526170000 / 20260526180000), now applied to the authenticated
-- scored RPC. `SuggestionService` calls this for logged-in users; it was
-- spiking to ~6.2s on staging (8s authenticated budget), the same
-- `[SuggestionService] RPC error` 57014 risk.
--
-- Two measured dominant costs (EXPLAIN ANALYZE BUFFERS, staging tennis caller
-- 4ac1ea90), both fixed here with result-equivalent rewrites:
--
--   #2 OVERLAP-ONCE. Caller↔opponent availability overlap was computed THREE
--      times per opponent: the `EXISTS` availability filter in `opponents`,
--      the `score_overlap` count, and the final `overlap_json`. The EXISTS
--      filter alone was a per-(opponent × caller slot) index probe behind a
--      useless Memoize (Hits 0 / Misses 1542 / Evictions 1523) — ~3.1k of
--      5.4k buffers (~58%) on a caller that returns only 23 rows. We now
--      compute overlap ONCE in a MATERIALIZED `opp_overlap` CTE (caller_avail
--      ⋈ player_availability, grouped by player → one pass), INNER JOIN it
--      into `opponents` (the join replaces the EXISTS filter: presence ⟺
--      overlap_cnt ≥ 1, provably identical), and read `score_overlap` from
--      it. `overlap_json` stays a correlated subquery — it only runs for the
--      final ≤p_limit rows, so it is already bounded.
--
--   #3 BOOKABILITY-ONCE. `score_bookability` used a correlated COUNT subquery
--      over `facility_availability_snapshot`, and is textually referenced 4×
--      (matchups output, ranked fac_affinity, ranked total_score, ORDER BY),
--      so Postgres ran the per-facility aggregate four times per matchup row.
--      Cheap when the snapshot visibility map is warm, but it churns
--      constantly from the refresh worker, so it degrades into heap fetches
--      and is the cache-sensitive source of the multi-second p-max (same
--      pathology measured on the anon RPC: ~22k buffers). We now compute the
--      per-facility count ONCE in a MATERIALIZED `facility_bookable` CTE over
--      the caller's favorited facilities (the only facilities `matchups` can
--      emit, since it inner-joins caller-favorited `cpff`), with a small
--      `facility_refreshed` set for the never-refreshed → 0.5 branch.
--      MATERIALIZED is required (without it PG inlines and re-runs per row).
--
--   Also: the `score_facility_geo` caller-favorited `EXISTS(cpff …)` is always
--   TRUE (the `matchups` cpff join already requires it), so it is folded to
--   the constant 0.30 — removing 3 more correlated subplans (and trimming the
--   ~256ms planning time of this ~20-CTE query). Provably equivalent.
--
--   Bookability/overlap arithmetic is otherwise unchanged. Verified
--   byte-identical read-only on staging: full 24+1-column EXCEPT both ways for
--   multiple callers — 0 rows divergent. Signature/return shape unchanged →
--   no TypeScript type regeneration.
--
-- NOTE: wall-clock is noisy run-to-run due to snapshot autovacuum churn; the
-- reliable signal is the buffer / heap-fetch reduction, which is what tames
-- the cold/contended-cache p-max.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_match_suggestions_scored(
  p_player_id uuid,
  p_sport_id  uuid,
  p_limit     integer DEFAULT 50,
  p_lat       double precision DEFAULT NULL::double precision,
  p_lng       double precision DEFAULT NULL::double precision
)
 RETURNS TABLE(
  opponent_id uuid, opponent_first_name text, opponent_last_name text, opponent_avatar text,
  opponent_reputation_score numeric, opponent_reputation_tier reputation_tier,
  opponent_rating_value double precision, opponent_rating_label text, opponent_badge_status badge_status_enum,
  facility_id uuid, facility_name text, facility_address text, facility_city text,
  facility_data_provider_id uuid, facility_provider_type text, facility_external_id text,
  facility_booking_url_tpl text, facility_timezone text, overlapping_days_periods jsonb,
  match_type match_type_enum, match_duration match_duration_enum,
  player_compatibility numeric, facility_affinity numeric, matchup_score numeric, score_history numeric
)
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

GRANT EXECUTE ON FUNCTION public.get_match_suggestions_scored(
  uuid, uuid, integer, double precision, double precision
) TO authenticated;
