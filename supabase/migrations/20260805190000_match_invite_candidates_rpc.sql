-- ============================================================================
-- Migration: Compatibility-ranked invite candidates for a match
-- Created: 2026-08-05
-- Description: get_match_invite_candidates(p_match_id, p_limit, p_offset)
--              ranks potential invitees for the HOST of a match by the same
--              behavioral compatibility signals get_just_for_you uses, with
--              invite-specific weights. Replaces the invite screen's
--              distance-only ordering.
--
-- Scoring (base weights sum to 1.00, then pair-history bonus and penalties):
--   0.25 availability at the game's weekday+hour (unknown schedule = 0.4
--        neutral: absence of data must not bury a player)
--   0.18 responsiveness — response RATE, not speed (see the CTE for the
--        exclusions); needs >= 3 qualifying invites else 0.5 neutral. The
--        returned `responds_fast` flag is likewise rate-based; the UI labels
--        it "Responsive" for that reason.
--   0.20 skill fit vs the gate rating (match minimum, else host active),
--        including the badge-status interplay
--   0.09 proximity to the match point (linear decay over the candidate's own
--        travel radius; favorite-facility candidates with no location = 0.7;
--        low weight on purpose: the pool is already proximity-bounded)
--   0.10 match-type fit (game's expectation vs candidate preference)
--   0.08 activity recency (player_activity_score)
--   0.05 duration fit
--   0.05 reputation (private reputation = 0.5 neutral)
--   + pair history bonus/penalty capped at +/-0.5 (played together weight,
--     host's past star ratings of them, host favorited them, minus their
--     no-shows/lates toward the host)
--   - 0.15 when the candidate's rating badge is disputed
--
-- Skill closeness is a SCORE here, not the exact-equality hard gate used by
-- auto-invites: a human host browsing may invite outside the band on purpose.
--
-- Reason flags come back with each row so the UI can explain the ranking
-- (available at game time, responds fast, played together, etc).
--
-- Perf: pool is pre-bounded (radius/favorite/past-partner, ORDER BY distance
-- LIMIT 300) BEFORE any scoring, mirroring the JFY fix that ended the
-- suggestion-RPC timeouts. Host-only, SECURITY DEFINER.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_match_invite_candidates(
  p_match_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  display_name text,
  profile_picture_url text,
  city text,
  gender text,
  rating_label text,
  rating_value double precision,
  badge_status text,
  reputation_tier text,
  reputation_score numeric,
  reputation_is_public boolean,
  distance_meters double precision,
  compat_score numeric,
  available_at_slot boolean,
  responds_fast boolean,
  active_recently boolean,
  played_together boolean,
  same_rating boolean,
  favorite_facility boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_m record;
  v_point extensions.geography;
  v_day text;
  v_hour int;
  v_gate_rating_score_id uuid;
  v_gate_rating_value double precision;
  v_host_badge badge_status_enum;
BEGIN
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  SELECT m.*, f.location AS fac_location
    INTO v_m
    FROM match m
    LEFT JOIN facility f ON f.id = m.facility_id
   WHERE m.id = p_match_id;

  -- Host-only surface.
  IF v_m IS NULL OR v_m.created_by != v_caller THEN
    RETURN;
  END IF;

  -- Match point: facility, else custom coords, else the host's own location.
  IF v_m.fac_location IS NOT NULL THEN
    v_point := v_m.fac_location;
  ELSIF v_m.custom_latitude IS NOT NULL AND v_m.custom_longitude IS NOT NULL THEN
    v_point := extensions.ST_SetSRID(
      extensions.ST_MakePoint(v_m.custom_longitude, v_m.custom_latitude), 4326
    )::extensions.geography;
  ELSE
    SELECT p.location INTO v_point FROM player p WHERE p.id = v_caller;
  END IF;

  v_day := CASE EXTRACT(isodow FROM v_m.match_date)::int
    WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday'
    WHEN 7 THEN 'sunday' END;
  v_hour := EXTRACT(hour FROM v_m.start_time)::int;

  -- Gate rating: explicit match minimum, else the host's active rating.
  IF v_m.min_rating_score_id IS NOT NULL THEN
    v_gate_rating_score_id := v_m.min_rating_score_id;
    SELECT rs.value INTO v_gate_rating_value
      FROM rating_score rs WHERE rs.id = v_m.min_rating_score_id;
  ELSE
    SELECT prs.rating_score_id, rs.value
      INTO v_gate_rating_score_id, v_gate_rating_value
      FROM player_sport hps
      JOIN player_rating_score prs ON prs.id = hps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE hps.player_id = v_caller AND hps.sport_id = v_m.sport_id
     LIMIT 1;
  END IF;

  SELECT prs.badge_status INTO v_host_badge
    FROM player_sport hps
    JOIN player_rating_score prs ON prs.id = hps.active_rating_score_id
   WHERE hps.player_id = v_caller AND hps.sport_id = v_m.sport_id
   LIMIT 1;

  RETURN QUERY
  WITH blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = v_caller
    UNION
    SELECT b.player_id AS pid FROM player_block b WHERE b.blocked_player_id = v_caller
  ),

  -- Bounded candidate pool BEFORE scoring: near the match, or a favorite of
  -- its facility, or someone the host already played with.
  pool AS (
    SELECT
      p.id AS pid,
      p.location,
      p.max_travel_distance,
      p.gender AS p_gender,
      ps.preferred_match_type,
      ps.preferred_match_duration,
      CASE WHEN v_point IS NOT NULL AND p.location IS NOT NULL
        THEN extensions.ST_Distance(p.location, v_point)
      END AS dist_m,
      EXISTS (
        SELECT 1 FROM player_favorite_facility pff
        WHERE pff.player_id = p.id
          AND v_m.facility_id IS NOT NULL
          AND pff.facility_id = v_m.facility_id
      ) AS fav_facility
    FROM player p
    JOIN player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = v_m.sport_id AND ps.is_active
    WHERE p.id != v_caller
      AND p.id NOT IN (SELECT b.pid FROM blocked_ids b)
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp
        WHERE mp.match_id = p_match_id AND mp.player_id = p.id
      )
      AND (
        v_m.preferred_opponent_gender IS NULL
        OR p.gender = v_m.preferred_opponent_gender
      )
      AND (
        (
          v_point IS NOT NULL
          AND p.location IS NOT NULL
          AND extensions.ST_DWithin(
                p.location, v_point,
                LEAST(COALESCE(p.max_travel_distance, 25), 25) * 1000)
        )
        OR EXISTS (
          SELECT 1 FROM player_favorite_facility pff2
          WHERE pff2.player_id = p.id
            AND v_m.facility_id IS NOT NULL
            AND pff2.facility_id = v_m.facility_id
        )
        OR EXISTS (
          SELECT 1
          FROM match_participant me
          JOIN match pm ON pm.id = me.match_id
          JOIN match_participant other
            ON other.match_id = me.match_id AND other.player_id = p.id
           AND other.status = 'joined'
          WHERE me.player_id = v_caller AND me.status = 'joined'
            AND pm.cancelled_at IS NULL AND pm.match_date < CURRENT_DATE
        )
      )
    ORDER BY dist_m ASC NULLS LAST
    LIMIT 300
  ),

  effective_rating AS (
    SELECT prs.player_id,
           prs.rating_score_id,
           rs.value::double precision AS rating_value,
           rs.label::text AS rating_label,
           prs.badge_status
    FROM player_sport eps
    JOIN player_rating_score prs ON prs.id = eps.active_rating_score_id
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE eps.sport_id = v_m.sport_id
      AND eps.player_id IN (SELECT po.pid FROM pool po)
  ),

  -- Responsiveness over invites the player actually had a fair chance to
  -- answer (90d). Exclusions follow specs/responsiveness/README.md §2, whose
  -- prod pull showed the metric is meaningless without them:
  --   * auto-generated invites (5.0% response rate vs 32.9% human) would make
  --     every player look unresponsive;
  --   * non-responses on games the HOST later cancelled aren't the invitee's
  --     fault (63% of ignored human invites);
  --   * self-requests (requested_at set) are not invites at all.
  -- 'kicked' counts as responded: the host removed them after they joined.
  responsiveness AS (
    SELECT mp.player_id,
           COUNT(*) AS received,
           COUNT(*) FILTER (
             WHERE mp.responded_at IS NOT NULL
                OR mp.status IN ('joined','declined','left','refused','kicked')
           ) AS responded,
           COUNT(*) FILTER (WHERE mp.status = 'joined') AS accepted
    FROM match_participant mp
    JOIN match m2 ON m2.id = mp.match_id
    WHERE mp.player_id IN (SELECT po.pid FROM pool po)
      AND mp.created_at >= now() - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m2.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND mp.requested_at IS NULL
      AND COALESCE(m2.is_auto_generated, false) = false
      AND NOT (
        m2.cancelled_at IS NOT NULL
        AND mp.responded_at IS NULL
        AND mp.status NOT IN ('joined','declined','left','refused','kicked')
      )
      AND (m2.match_date < CURRENT_DATE OR mp.created_at < now() - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  -- Pair history, host-centric subset of the JFY history CTE.
  pair_matches AS (
    SELECT other.player_id AS pid,
           SUM(CASE
                 WHEN pm.match_date >= CURRENT_DATE - 90  THEN 1.0
                 WHEN pm.match_date >= CURRENT_DATE - 180 THEN 0.5
                 WHEN pm.match_date >= CURRENT_DATE - 365 THEN 0.25
                 ELSE 0.0
               END) AS pair_weight,
           COUNT(*) AS pair_count
    FROM match_participant me
    JOIN match pm ON pm.id = me.match_id
    JOIN match_participant other
      ON other.match_id = me.match_id
     AND other.player_id != v_caller
     AND other.status = 'joined'
    WHERE me.player_id = v_caller AND me.status = 'joined'
      AND pm.cancelled_at IS NULL AND pm.match_date < CURRENT_DATE
      AND other.player_id IN (SELECT po.pid FROM pool po)
    GROUP BY other.player_id
  ),
  pair_feedback AS (
    SELECT mf.opponent_id AS pid,
           SUM(CASE
                 WHEN fm.match_date >= CURRENT_DATE - 90  THEN 1.0
                 WHEN fm.match_date >= CURRENT_DATE - 180 THEN 0.5
                 WHEN fm.match_date >= CURRENT_DATE - 365 THEN 0.25
                 ELSE 0.0
               END * ((mf.star_rating - 3)::numeric / 2.0)
              ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_signed_weighted,
           SUM(CASE
                 WHEN fm.match_date >= CURRENT_DATE - 90  THEN 1.0
                 WHEN fm.match_date >= CURRENT_DATE - 180 THEN 0.5
                 WHEN fm.match_date >= CURRENT_DATE - 365 THEN 0.25
                 ELSE 0.0
               END) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_weight_sum,
           COUNT(*) FILTER (WHERE mf.showed_up = FALSE) AS no_shows,
           COUNT(*) FILTER (WHERE mf.was_late = TRUE) AS lates,
           COUNT(*) AS fb_events
    FROM match_feedback mf
    JOIN match fm ON fm.id = mf.match_id
    WHERE mf.reviewer_id = v_caller
      AND mf.opponent_id IN (SELECT po.pid FROM pool po)
    GROUP BY mf.opponent_id
  ),

  scored AS (
    SELECT
      po.pid,
      po.dist_m,
      po.fav_facility,
      er.rating_score_id,
      er.rating_value,
      er.rating_label,
      er.badge_status,
      -- reason primitives
      EXISTS (
        SELECT 1 FROM player_availability pa
        WHERE pa.player_id = po.pid AND pa.is_active
          AND pa.day::text = v_day AND pa.hour_of_day = v_hour
      ) AS avail_cell,
      EXISTS (
        SELECT 1 FROM player_availability pa2
        WHERE pa2.player_id = po.pid AND pa2.is_active
      ) AS has_avail_rows,
      COALESCE(r.received, 0) AS resp_received,
      CASE
        WHEN COALESCE(r.received, 0) >= 3 THEN
          LEAST(1.0::numeric, GREATEST(0.0::numeric,
            0.7 * (r.responded::numeric / NULLIF(r.received, 0))
          + 0.3 * (CASE WHEN r.responded > 0 THEN r.accepted::numeric / r.responded ELSE 0.5 END)))
        ELSE 0.5::numeric
      END AS score_responsiveness,
      public.player_activity_score(po.pid)::numeric AS score_activity,
      CASE
        WHEN v_gate_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_gate_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_gate_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_gate_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      * CASE
          WHEN v_host_badge IS NULL THEN
            CASE er.badge_status WHEN 'certified' THEN 0.5 WHEN 'self_declared' THEN 0.5 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
          WHEN v_host_badge = 'certified' THEN
            CASE er.badge_status WHEN 'certified' THEN 1.0 WHEN 'self_declared' THEN 0.6 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
          WHEN v_host_badge = 'self_declared' THEN
            CASE er.badge_status WHEN 'certified' THEN 0.6 WHEN 'self_declared' THEN 0.4 WHEN 'disputed' THEN 0.2 ELSE 0.5 END
          WHEN v_host_badge = 'disputed' THEN
            CASE er.badge_status WHEN 'certified' THEN 0.3 WHEN 'self_declared' THEN 0.2 WHEN 'disputed' THEN 0.1 ELSE 0.3 END
          ELSE 0.5
        END AS score_skill,
      CASE
        WHEN v_m.player_expectation IS NULL OR v_m.player_expectation = 'both' THEN
          CASE WHEN po.preferred_match_type IS NULL THEN 0.7 ELSE 0.8 END
        WHEN po.preferred_match_type IS NULL THEN 0.5
        WHEN po.preferred_match_type::text = v_m.player_expectation::text THEN 1.0
        WHEN po.preferred_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,
      CASE
        WHEN v_m.duration IS NULL OR po.preferred_match_duration IS NULL THEN 0.5
        WHEN v_m.duration::text = po.preferred_match_duration::text THEN 1.0
        WHEN (v_m.duration::text, po.preferred_match_duration::text) IN
             (('30','60'),('60','30'),('60','90'),('90','60'),('90','120'),('120','90')) THEN 0.5
        WHEN (v_m.duration::text, po.preferred_match_duration::text) IN
             (('30','90'),('90','30'),('60','120'),('120','60')) THEN 0.3
        ELSE 0.2
      END AS score_duration,
      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,
      prep.reputation_tier,
      prep.reputation_score AS rep_score_raw,
      COALESCE(prep.is_public, FALSE) AS rep_public,
      CASE
        WHEN po.dist_m IS NOT NULL THEN
          GREATEST(0.0, 1.0 - po.dist_m / (LEAST(COALESCE(po.max_travel_distance, 25), 25) * 1000.0))
        WHEN po.fav_facility THEN 0.7
        ELSE 0.3
      END AS score_proximity,
      COALESCE(pmh.pair_weight, 0) AS pair_weight,
      COALESCE(pmh.pair_count, 0) AS pair_count,
      pf.star_signed_weighted,
      pf.star_weight_sum,
      COALESCE(pf.no_shows, 0) AS no_shows,
      COALESCE(pf.lates, 0) AS lates,
      COALESCE(pf.fb_events, 0) AS fb_events,
      EXISTS (
        SELECT 1 FROM player_favorite pfav
        WHERE pfav.player_id = v_caller AND pfav.favorite_player_id = po.pid
      ) AS host_favorited
    FROM pool po
    LEFT JOIN effective_rating er ON er.player_id = po.pid
    LEFT JOIN responsiveness r ON r.player_id = po.pid
    LEFT JOIN player_reputation prep ON prep.player_id = po.pid
    LEFT JOIN pair_matches pmh ON pmh.pid = po.pid
    LEFT JOIN pair_feedback pf ON pf.pid = po.pid
  ),

  final AS (
    SELECT
      s.*,
      LEAST(1.5, GREATEST(0.0,
        ( 0.25 * (CASE WHEN s.avail_cell THEN 1.0 WHEN s.has_avail_rows THEN 0.0 ELSE 0.4 END)
        + 0.18 * s.score_responsiveness
        + 0.20 * s.score_skill
        + 0.09 * s.score_proximity
        + 0.10 * s.score_match_type
        + 0.08 * s.score_activity
        + 0.05 * s.score_duration
        + 0.05 * s.score_reputation
        )
        + GREATEST(-0.5, LEAST(0.5,
            (CASE WHEN s.pair_count = 0 AND s.fb_events = 0 AND NOT s.host_favorited THEN 0
             ELSE
               LEAST(0.40, s.pair_weight * 0.10)
             + CASE WHEN s.star_weight_sum IS NOT NULL AND s.star_weight_sum > 0
                 THEN GREATEST(-0.30, LEAST(0.30, (s.star_signed_weighted / s.star_weight_sum) * 0.30))
                 ELSE 0 END
             + CASE WHEN s.host_favorited THEN 0.15 ELSE 0 END
             - LEAST(0.40, s.no_shows * 0.25)
             - LEAST(0.10, s.lates * 0.05)
            END)))
        - (CASE WHEN s.badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::numeric(8,4) AS compat
    FROM scored s
  )

  SELECT
    f.pid,
    COALESCE(pr.first_name, ''),
    COALESCE(pr.last_name, ''),
    pr.display_name,
    pr.profile_picture_url,
    pl.city,
    pl.gender::text,
    f.rating_label,
    f.rating_value,
    f.badge_status::text,
    f.reputation_tier::text,
    f.rep_score_raw,
    f.rep_public,
    f.dist_m,
    f.compat,
    f.avail_cell,
    (f.resp_received >= 3 AND f.score_responsiveness >= 0.7),
    (f.score_activity >= 0.85),
    (f.pair_count >= 1),
    (v_gate_rating_score_id IS NOT NULL AND f.rating_score_id = v_gate_rating_score_id),
    f.fav_facility,
    COUNT(*) OVER ()
  FROM final f
  JOIN profile pr ON pr.id = f.pid
  JOIN player pl ON pl.id = f.pid
  ORDER BY f.compat DESC, f.dist_m ASC NULLS LAST
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_invite_candidates(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_invite_candidates(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_match_invite_candidates(uuid, int, int) IS
  'Host-only: invite candidates for a match ranked by JFY-style behavioral compatibility with invite-specific weights, plus reason flags for the UI.';
