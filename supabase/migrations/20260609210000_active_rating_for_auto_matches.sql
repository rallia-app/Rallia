-- =============================================================================
-- Auto matches read the player's ACTIVE rating (player_sport.active_rating_score_id)
--
-- Two consumers move off rating-resolution heuristics onto the explicit active
-- rating added in 20260608140000:
--
--   1. get_auto_invite_candidates — the exact-rating gate now compares ACTIVE
--      ratings by rating_score id (same system AND same value), the same
--      semantics notify_nearby_players_on_match_created adopted in
--      20260608150000. This also restores the active-rating preference that
--      20260608170000 had given this function and 20260609185000 accidentally
--      rebuilt from the older heuristic body. Unrated host (no active rating)
--      still means no gate — the match is open to all levels.
--
--   2. generate_weekly_matches_for_player — the match's required level
--      (min_rating_score_id) is now the host's active rating's score, replacing
--      the primary-system (tennis→NTRP, pickleball→DUPR) most-recent lookup.
--      Match minimum, invite gate, and nearby notification now share one
--      definition of "the host's rating".
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates(
  p_match_id uuid,
  p_max      int DEFAULT 50  -- safety bound against pathological pools, not a targeting knob
)
RETURNS TABLE (player_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  m               record;
  v_host_score_id uuid;
  v_weekday       day_enum;
  v_hour          int;
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

  v_weekday := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
                 [extract(dow from m.match_date)::int + 1]::day_enum;
  v_hour    := extract(hour from m.start_time)::int;

  -- Host's active rating for the sport → the rating_score it points at.
  SELECT prs.rating_score_id INTO v_host_score_id
    FROM public.player_sport hps
    JOIN public.player_rating_score prs ON prs.id = hps.active_rating_score_id
   WHERE hps.player_id = m.created_by
     AND hps.sport_id  = m.sport_id;

  RETURN QUERY
  SELECT p.id
    FROM public.player p
    JOIN public.player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = m.sport_id AND ps.is_active
    JOIN public.player_availability pa
      ON pa.player_id = p.id AND pa.is_active
     AND pa.day = v_weekday AND pa.hour_of_day = v_hour
    LEFT JOIN public.player_rating_score cprs ON cprs.id = ps.active_rating_score_id
    LEFT JOIN public.player_reputation prep ON prep.player_id = p.id
   WHERE p.id <> m.created_by
     -- exact rating gate: candidate's ACTIVE rating is the same rating_score
     -- (system + value) as the host's. Unrated host = open to all, no gate.
     AND (v_host_score_id IS NULL OR cprs.rating_score_id = v_host_score_id)
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
     -- not already in this match (any status: pending/declined/left rows stay authoritative)
     AND NOT EXISTS (
       SELECT 1 FROM public.match_participant mp0
        WHERE mp0.match_id = p_match_id AND mp0.player_id = p.id
     )
     -- no overlapping REAL commitment. Only 'joined' blocks; an unanswered
     -- invite or request is not a calendar hold. The candidate's own
     -- still-unfilled auto match (host row, no opponent joined) doesn't block.
     AND NOT EXISTS (
       SELECT 1
         FROM public.match m2
         JOIN public.match_participant mp2
           ON mp2.match_id = m2.id AND mp2.player_id = p.id
          AND mp2.status = 'joined'
        WHERE m2.cancelled_at IS NULL
          AND m2.match_date = m.match_date
          AND m2.start_time < m.end_time
          AND m2.end_time   > m.start_time
          AND NOT (
            m2.is_auto_generated = TRUE
            AND m2.created_by = p.id
            AND NOT EXISTS (
              SELECT 1 FROM public.match_participant mp4
               WHERE mp4.match_id = m2.id AND mp4.status = 'joined' AND mp4.player_id <> p.id
            )
          )
     )
   ORDER BY
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
$$;

COMMENT ON FUNCTION public.get_auto_invite_candidates(uuid, int) IS
  'ALL eligible opponents (ranked) to auto-invite to an auto-created match. '
  'Hard filters: candidate''s ACTIVE rating is the same rating_score as the '
  'host''s active rating (no gate when host has none), sport active, exact '
  'slot availability, block-list, gender, travel radius, not already in the '
  'match, no overlapping JOINED commitment (own unfilled auto match exempt). '
  'Ranking: match-type > reputation. Push anti-spam lives in '
  'generate-weekly-matches.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates(uuid, int) TO service_role;

-- -----------------------------------------------------------------------------
-- generate_weekly_matches_for_player: min_rating_score_id = host's active rating
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_weekly_matches_for_player(p_player_id uuid)
RETURNS TABLE (
  match_id      uuid,
  sport_name    varchar,
  match_date    date,
  start_time    time without time zone,
  end_time      time without time zone,
  facility_name varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz                  text;
  v_today               date;
  v_week_start          date;        -- player-local Monday of the current ISO week
  v_now_hour            int;
  v_auto_create         boolean;
  v_player_loc          extensions.geography;
  v_sport               record;
  v_sel                 record;
  v_duration_min        int;
  v_duration_enum       match_duration_enum;
  v_location_type       text;
  v_court_status        text;
  v_target_date         date;
  v_hour                int;
  v_start               time;
  v_end                 time;
  v_match_id            uuid;
BEGIN
  -- Resolve timezone + home location (fall back to UTC).
  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC'), p.location
    INTO v_tz, v_player_loc
    FROM public.player p
   WHERE p.id = p_player_id;
  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  v_today      := (now() AT TIME ZONE v_tz)::date;
  v_week_start := date_trunc('week', (now() AT TIME ZONE v_tz))::date;  -- Monday
  v_now_hour   := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;

  -- Gate: must have opted in to auto-create.
  SELECT pref.auto_create_matches INTO v_auto_create
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = p_player_id;
  IF v_auto_create IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  -- For EACH active sport, create one match per available day. A player with
  -- both tennis and pickleball gets a match of each sport on every available
  -- day (subject to the time-overlap guard — two sports can't share one hour).
  FOR v_sport IN
    SELECT ps.sport_id,
           s.name                       AS sport_name,
           ps.preferred_match_duration  AS duration,
           ps.preferred_match_type      AS match_type,
           -- Required level = the host's ACTIVE rating for the sport (the same
           -- score the invite gate and nearby notification compare against).
           -- No active rating → NULL → open to all levels.
           prs.rating_score_id          AS min_rating_score_id
      FROM public.player_sport ps
      JOIN public.sport s ON s.id = ps.sport_id
      LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE ps.player_id = p_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
  LOOP
    -- Duration enum straight from the player's per-sport preference. There's no
    -- per-sport custom-minutes source, so 'custom'/NULL fall back to 60; end_time
    -- is derived from the same value so the two always agree.
    v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
    v_duration_min  := COALESCE(
      public.parse_match_duration_to_minutes(v_duration_enum::text), 60
    );

    -- Walk each DISTINCT available day for this sport, soonest-first. Days are
    -- distinct here, so "one match per (sport, day)" is inherent.
    FOR v_target_date IN
      SELECT DISTINCT v_week_start + (CASE pa.day::text
               WHEN 'monday'    THEN 0
               WHEN 'tuesday'   THEN 1
               WHEN 'wednesday' THEN 2
               WHEN 'thursday'  THEN 3
               WHEN 'friday'    THEN 4
               WHEN 'saturday'  THEN 5
               WHEN 'sunday'    THEN 6
             END)
        FROM public.player_availability pa
       WHERE pa.player_id = p_player_id
         AND pa.is_active = TRUE
       ORDER BY 1
    LOOP
      -- Future-only window: today (now) → Sunday. Earlier days skipped.
      CONTINUE WHEN v_target_date < v_today;
      -- Idempotency: a day that already has an auto match for this sport.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = p_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport.sport_id
           AND m2.match_date = v_target_date
      );

      -- Optimize (facility, hour) for this day among the player's favorite
      -- facilities for the sport and their future-valid hours. Priority:
      --   1. bookable facilities with courts available — most courts wins;
      --   2. first-come, first-served facilities (no booking) when no bookable
      --      facility has availability;
      --   3. anything else (bookable but nothing currently available).
      -- Within/across tiers, ties break by nearest facility then earliest hour.
      -- A sport-agnostic favorite (sport_id IS NULL) is eligible too.
      SELECT cand.facility_id, cand.facility_name, cand.address, cand.hour_of_day
        INTO v_sel
        FROM (
          SELECT f.id AS facility_id, f.name AS facility_name, f.address,
                 pa.hour_of_day,
                 ( SELECT count(DISTINCT fas.external_court_id)
                     FROM public.facility_availability_snapshot fas
                    WHERE fas.facility_id = f.id
                      AND fas.is_available = TRUE
                      AND (fas.sport_id = v_sport.sport_id OR fas.sport_id IS NULL)
                      AND fas.slot_start =
                          ((v_target_date + make_time(pa.hour_of_day, 0, 0))::timestamp
                             AT TIME ZONE v_tz)
                 ) AS court_count,
                 CASE WHEN v_player_loc IS NOT NULL AND f.location IS NOT NULL
                      THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist,
                 f.is_first_come_first_serve AS is_fcfs
            FROM public.player_availability pa
            JOIN public.player_favorite_facility pff
              ON pff.player_id = p_player_id
             AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
            JOIN public.facility f
              ON f.id = pff.facility_id AND f.is_active = TRUE
           WHERE pa.player_id = p_player_id
             AND pa.is_active = TRUE
             AND v_week_start + (CASE pa.day::text
                   WHEN 'monday'    THEN 0
                   WHEN 'tuesday'   THEN 1
                   WHEN 'wednesday' THEN 2
                   WHEN 'thursday'  THEN 3
                   WHEN 'friday'    THEN 4
                   WHEN 'saturday'  THEN 5
                   WHEN 'sunday'    THEN 6
                 END) = v_target_date
             AND NOT (v_target_date = v_today AND pa.hour_of_day <= v_now_hour)
        ) cand
       ORDER BY
         -- Tier: bookable facilities with courts available first; then
         -- first-come, first-served facilities; then anything else (bookable
         -- but nothing currently available).
         CASE
           WHEN cand.court_count > 0 THEN 0
           WHEN cand.is_fcfs        THEN 1
           ELSE 2
         END ASC,
         cand.court_count DESC,            -- within the bookable tier, most courts
         cand.dist        ASC NULLS LAST,  -- then nearest
         cand.hour_of_day ASC              -- then earliest hour
       LIMIT 1;

      IF FOUND THEN
        v_location_type := 'facility';
        v_court_status  := 'to_reserve';
        v_hour          := v_sel.hour_of_day;
      ELSE
        -- No favorite facility for this sport → TBD location, earliest hour.
        SELECT pa.hour_of_day INTO v_hour
          FROM public.player_availability pa
         WHERE pa.player_id = p_player_id
           AND pa.is_active = TRUE
           AND v_week_start + (CASE pa.day::text
                 WHEN 'monday'    THEN 0
                 WHEN 'tuesday'   THEN 1
                 WHEN 'wednesday' THEN 2
                 WHEN 'thursday'  THEN 3
                 WHEN 'friday'    THEN 4
                 WHEN 'saturday'  THEN 5
                 WHEN 'sunday'    THEN 6
               END) = v_target_date
           AND NOT (v_target_date = v_today AND pa.hour_of_day <= v_now_hour)
         ORDER BY pa.hour_of_day ASC
         LIMIT 1;
        CONTINUE WHEN NOT FOUND;  -- no future-valid hour this day
        v_location_type := 'tbd';
        v_court_status  := NULL;
      END IF;

      v_start := make_time(v_hour, 0, 0);
      v_end   := v_start + (v_duration_min || ' minutes')::interval;

      -- Don't stack an auto-match on top of a REAL commitment (a match the
      -- player manually hosts or has joined). The player's own auto-generated
      -- matches are NOT treated as conflicts, so every active sport can share
      -- the same time slot on a given day.
      CONTINUE WHEN EXISTS (
        SELECT 1
          FROM public.match m
          JOIN public.match_participant mp
            ON mp.match_id = m.id
           AND mp.player_id = p_player_id
           AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
         WHERE m.cancelled_at IS NULL
           AND m.match_date = v_target_date
           AND m.start_time < v_end
           AND m.end_time   > v_start
           AND NOT (m.is_auto_generated = TRUE AND m.created_by = p_player_id)
      );

      INSERT INTO public.match (
        sport_id, match_date, start_time, end_time, created_by,
        visibility, join_mode, format, player_expectation, duration,
        location_type, facility_id, location_name, location_address,
        court_status, min_rating_score_id, is_auto_generated, timezone
      ) VALUES (
        v_sport.sport_id, v_target_date, v_start, v_end, p_player_id,
        'public', 'request', 'singles', COALESCE(v_sport.match_type, 'both'), v_duration_enum,
        v_location_type::location_type_enum,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.address END,
        v_court_status::court_status_enum,
        v_sport.min_rating_score_id, TRUE, v_tz
      )
      RETURNING id INTO v_match_id;

      INSERT INTO public.match_participant (
        match_id, player_id, team_number, is_host, status, joined_at
      ) VALUES (
        v_match_id, p_player_id, 1, TRUE, 'joined', now()
      )
      ON CONFLICT ON CONSTRAINT match_participant_match_id_player_id_key DO NOTHING;

      match_id      := v_match_id;
      sport_name    := v_sport.sport_name;
      generate_weekly_matches_for_player.match_date  := v_target_date;
      generate_weekly_matches_for_player.start_time  := v_start;
      generate_weekly_matches_for_player.end_time    := v_end;
      facility_name := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_matches_for_player(uuid) IS
  'Creates one open (request-to-join) match per available day per active sport, '
  'hosted by the player. Required level = the host''s ACTIVE rating for the '
  'sport (player_sport.active_rating_score_id); NULL when none. Per day it '
  'picks the favorite facility/hour by tier: bookable-with-courts-available '
  '(most courts) > first-come-first-served > rest, tie-broken by nearest then '
  'earliest; falls back to TBD when no favorites. Gated on auto_create_matches. '
  'Idempotent per week.';

REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_player(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_player(uuid) TO service_role;
