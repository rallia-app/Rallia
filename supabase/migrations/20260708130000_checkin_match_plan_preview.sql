-- =============================================================================
-- Weekly check-in: transparent match plan (preview → confirm) — read side
--
-- The wizard's auto-match step becomes a PREVIEW: before submitting, the player
-- sees exactly which games would be created and exactly who would be invited to
-- each, and can exclude games / individual invitees. To make that possible
-- without two divergent copies of the selection logic, this migration factors
-- the existing machinery into shared cores:
--
--   1. get_auto_invite_candidates_for_slot — the candidate query of
--      get_auto_invite_candidates parameterized on match fields instead of a
--      match row (no match exists at preview time), now returning display
--      fields (name / avatar / rating label / reputation) straight from SQL.
--   2. get_auto_invite_candidates — rewritten as a thin wrapper over (1):
--      reads the match row, delegates, re-adds the only check that needs an
--      existing match ("not already a participant"). Same signature, same
--      service_role-only grant — the edge function's legacy path is untouched.
--   3. plan_weekly_matches_for_player — the SELECTION half of
--      generate_weekly_matches_for_player, parameterized on unsaved p_slots
--      (the wizard's in-memory grid, same [{day,hour}] jsonb contract as
--      get_checkin_match_opportunities). Pure — zero writes.
--   4. create_weekly_match — the INSERT half (match + host participant),
--      shared by the legacy generator and the confirmed-plan execution path
--      (record_weekly_checkin, next migration).
--   5. generate_weekly_matches_for_player — rewritten as (3) fed from SAVED
--      availability + (4), preserving today's behavior byte-for-byte for the
--      cron sweep and for clients that don't send a plan.
--   6. get_checkin_match_plan — the authenticated preview RPC the wizard calls:
--      proposals + named invitees as one jsonb document.
--
-- The plan a client later submits is a SELECTION, not a spec: duration, rating
-- and facility details are always re-derived server-side at execution time.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Candidate core, parameterized on slot fields + returning display fields.
--    Body = the 20260620130000 query with the match row's fields as parameters
--    and the "not already in this match" check dropped (no match exists yet —
--    the wrapper re-adds it). Every gate and the ranking are otherwise
--    unchanged: exact active-rating equality (no gate when host unrated), sport
--    active, exact weekday+hour availability, block-list both ways, gender,
--    shared favorite facility within LEAST(10km, own max_travel) — NULL
--    facility (TBD) yields nobody — and no overlapping JOINED commitment (own
--    unfilled auto match exempt). Ranking: match-type compatibility > reputation.
--
--    Reputation display fields follow the suggestion-RPC convention
--    (20260515220100): tier renders 'unknown' and the score is withheld until
--    the player has ≥5 reputation events AND opted into a public reputation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates_for_slot(
  p_host_id     uuid,
  p_sport_id    uuid,
  p_facility_id uuid,
  p_match_date  date,
  p_start_time  time without time zone,
  p_end_time    time without time zone,
  p_gender      gender_enum      DEFAULT NULL,
  p_expectation match_type_enum  DEFAULT NULL,
  p_max         int              DEFAULT 50
)
RETURNS TABLE (
  player_id        uuid,
  first_name       text,
  last_name        text,
  avatar_url       text,
  rating_label     text,
  reputation_score numeric,
  reputation_tier  reputation_tier
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_host_score_id uuid;
  v_weekday       day_enum;
  v_hour          int;
BEGIN
  -- TBD slot (no facility): the shared-favorite-facility gate can never pass.
  IF p_facility_id IS NULL THEN
    RETURN;
  END IF;

  v_weekday := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
                 [extract(dow from p_match_date)::int + 1]::day_enum;
  v_hour    := extract(hour from p_start_time)::int;

  -- Host's active rating for the sport → the rating_score it points at.
  SELECT prs.rating_score_id INTO v_host_score_id
    FROM public.player_sport hps
    JOIN public.player_rating_score prs ON prs.id = hps.active_rating_score_id
   WHERE hps.player_id = p_host_id
     AND hps.sport_id  = p_sport_id;

  RETURN QUERY
  SELECT p.id,
         COALESCE(pr.first_name, ''),
         COALESCE(pr.last_name, ''),
         pr.profile_picture_url,
         rs.label::text,
         CASE WHEN COALESCE(prep.is_public, FALSE) AND COALESCE(prep.total_events, 0) >= 5
              THEN prep.reputation_score END,
         CASE WHEN COALESCE(prep.is_public, FALSE) AND COALESCE(prep.total_events, 0) >= 5
              THEN prep.reputation_tier
              ELSE 'unknown'::reputation_tier END
    FROM public.player p
    JOIN public.profile pr ON pr.id = p.id
    JOIN public.player_sport ps
      ON ps.player_id = p.id AND ps.sport_id = p_sport_id AND ps.is_active
    JOIN public.player_availability pa
      ON pa.player_id = p.id AND pa.is_active
     AND pa.day = v_weekday AND pa.hour_of_day = v_hour
    LEFT JOIN public.player_rating_score cprs ON cprs.id = ps.active_rating_score_id
    LEFT JOIN public.rating_score rs ON rs.id = cprs.rating_score_id
    LEFT JOIN public.player_reputation prep ON prep.player_id = p.id
   WHERE p.id <> p_host_id
     -- exact rating gate: candidate's ACTIVE rating is the same rating_score
     -- (system + value) as the host's. Unrated host = open to all, no gate.
     AND (v_host_score_id IS NULL OR cprs.rating_score_id = v_host_score_id)
     -- block-list, both directions
     AND NOT EXISTS (
       SELECT 1 FROM public.player_block b
        WHERE (b.player_id = p_host_id AND b.blocked_player_id = p.id)
           OR (b.player_id = p.id AND b.blocked_player_id = p_host_id)
     )
     -- the match's gender requirement, if any (mirrors join eligibility)
     AND (p_gender IS NULL OR p.gender = p_gender)
     -- strong-signal reach: the candidate must ALSO favorite the facility
     -- (sport-specific or all-sport) AND live within the LESSER of 10km or
     -- their own travel radius of it.
     AND p.location IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.player_favorite_facility pff
         JOIN public.facility f ON f.id = pff.facility_id
        WHERE pff.player_id  = p.id
          AND pff.facility_id = p_facility_id
          AND (pff.sport_id = p_sport_id OR pff.sport_id IS NULL)
          AND f.location IS NOT NULL
          AND extensions.ST_DWithin(
                f.location, p.location,
                LEAST(10, COALESCE(p.max_travel_distance, 10)) * 1000
              )
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
          AND m2.match_date = p_match_date
          AND m2.start_time < p_end_time
          AND m2.end_time   > p_start_time
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
       WHEN p_expectation IS NOT NULL AND p_expectation = ps.preferred_match_type THEN 1.0
       WHEN p_expectation = 'both' OR ps.preferred_match_type = 'both'            THEN 0.7
       ELSE 0.0
     END DESC,
     -- reputation (the RAW score ranks even when display is withheld)
     COALESCE(prep.reputation_score, 0) DESC
   LIMIT p_max;
END;
$$;

COMMENT ON FUNCTION public.get_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum, int) IS
  'Candidate core shared by the check-in plan PREVIEW (no match row yet) and '
  'get_auto_invite_candidates. Same hard filters as the 20260620130000 query '
  '(exact active-rating, sport active, exact weekday+hour availability, '
  'block-list, gender, shared favorite facility within Min(10km, max_travel) — '
  'NULL facility yields nobody, no overlapping JOINED commitment) and the same '
  'ranking (match-type > reputation), minus the participant check (no match '
  'yet). Returns display fields; reputation shown only when public AND ≥5 events.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates_for_slot(uuid, uuid, uuid, date, time, time, gender_enum, match_type_enum, int) TO service_role;


-- -----------------------------------------------------------------------------
-- 2. Existing entry point becomes a thin wrapper. Same signature, return shape
--    and ACL as 20260620130000 — the generate-weekly-matches edge function's
--    legacy path keeps working unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auto_invite_candidates(
  p_match_id uuid,
  p_max      int DEFAULT 50
)
RETURNS TABLE (player_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  m record;
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

  RETURN QUERY
  SELECT c.player_id
    FROM public.get_auto_invite_candidates_for_slot(
           m.created_by, m.sport_id, m.facility_id, m.match_date,
           m.start_time, m.end_time, m.preferred_opponent_gender,
           m.player_expectation, p_max) c
   -- the one gate that needs an existing match: not already a participant
   -- (any status: pending/declined/left rows stay authoritative)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.match_participant mp0
      WHERE mp0.match_id = p_match_id AND mp0.player_id = c.player_id
   );
END;
$$;

COMMENT ON FUNCTION public.get_auto_invite_candidates(uuid, int) IS
  'ALL eligible opponents (ranked) to auto-invite to an auto-created match. '
  'Thin wrapper over get_auto_invite_candidates_for_slot (the shared candidate '
  'core) that reads the match row and re-adds the not-already-a-participant '
  'filter. Filters and ranking documented on the core. Push anti-spam lives in '
  'generate-weekly-matches.';

REVOKE ALL ON FUNCTION public.get_auto_invite_candidates(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_invite_candidates(uuid, int) TO service_role;


-- -----------------------------------------------------------------------------
-- 3. Planner core — the selection half of generate_weekly_matches_for_player
--    (20260620120000), pure and parameterized on p_slots so the wizard can
--    preview from its in-memory grid before anything is saved.
--
--    Deliberate differences from the generator it was extracted from:
--      • availability comes from p_slots [{day,hour}] instead of saved
--        player_availability rows (same contract as get_checkin_match_opportunities);
--      • no auto_create_matches gate — BOTH callers gate for themselves (the
--        preview must render for opted-out players so they can opt back in);
--      • zero writes.
--    Everything else is intact, notably the rolling window: FOR d IN 0..3 over
--    EXACT local dates today…today+3. Do not "fix" it into a week loop — see
--    20260615060000 for the history of that regression.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_weekly_matches_for_player(
  p_player_id     uuid,
  p_slots         jsonb,
  p_goal_override int DEFAULT NULL
)
RETURNS TABLE (
  sport_id            uuid,
  sport_name          varchar,
  match_date          date,
  start_time          time without time zone,
  end_time            time without time zone,
  duration            match_duration_enum,
  match_type          match_type_enum,
  location_type       text,
  facility_id         uuid,
  facility_name       varchar,
  facility_address    text,
  court_status        text,
  min_rating_score_id uuid,
  min_rating_label    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz            text;
  v_today         date;
  v_now_hour      int;
  v_week_start    date;
  v_player_loc    extensions.geography;
  v_goal          int;
  v_committed     int;
  v_to_create     int;
  v_planned       int := 0;
  v_sport         record;
  v_sel           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_target_dow    text;
  v_hour          int;
  v_start         time;
  v_end           time;
  d               int;
BEGIN
  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC'), p.location
    INTO v_tz, v_player_loc
    FROM public.player p
   WHERE p.id = p_player_id;
  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  v_today      := (now() AT TIME ZONE v_tz)::date;
  v_now_hour   := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;
  v_week_start := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  -- Weekly games goal: explicit override (the wizard's just-picked goal — the
  -- week row may not exist yet at preview time), else this week's row, else the
  -- last goal, else a sane default.
  v_goal := p_goal_override;
  IF v_goal IS NULL THEN
    SELECT wc.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin wc
     WHERE wc.player_id = p_player_id
       AND wc.week_start_date = v_week_start;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = p_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  -- Cap planning to the goal NET of games already lined up in the window —
  -- including ones the player just joined / asked to join on the check-in's
  -- "Games for you" step. Counting their own previously auto-created matches too
  -- (they're a 'joined' host participant) keeps this idempotent across re-runs.
  SELECT count(DISTINCT m.id) INTO v_committed
    FROM public.match m
    JOIN public.match_participant mp ON mp.match_id = m.id
   WHERE mp.player_id = p_player_id
     AND mp.status IN ('joined', 'requested', 'waitlisted')
     AND m.cancelled_at IS NULL
     AND m.match_date BETWEEN v_today AND v_today + 3;

  v_to_create := GREATEST(0, v_goal - COALESCE(v_committed, 0));
  IF v_to_create <= 0 THEN
    RETURN;  -- goal already met by real games — plan nothing
  END IF;

  -- Walk the rolling window SOONEST-FIRST (today … today+3), interleaving the
  -- player's active sports per day (primary first), planning one match per
  -- (sport, day) until the remaining goal is filled.
  <<day_loop>>
  FOR d IN 0..3 LOOP
    v_target_date := v_today + d;
    v_target_dow  := CASE EXTRACT(isodow FROM v_target_date)::int
                       WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                       WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                       WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                       WHEN 7 THEN 'sunday' END;

    FOR v_sport IN
      SELECT ps.sport_id                  AS sport_id,
             s.name                       AS sport_name,
             ps.preferred_match_duration  AS duration,
             ps.preferred_match_type      AS match_type,
             -- Required level = the host's ACTIVE rating for the sport.
             prs.rating_score_id          AS min_rating_score_id,
             rs.label::text               AS min_rating_label
        FROM public.player_sport ps
        JOIN public.sport s ON s.id = ps.sport_id
        LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
        LEFT JOIN public.rating_score rs ON rs.id = prs.rating_score_id
       WHERE ps.player_id = p_player_id
         AND ps.is_active = TRUE
       ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
    LOOP
      EXIT day_loop WHEN v_planned >= v_to_create;

      -- Skip days the declared slots don't cover (that weekday).
      CONTINUE WHEN NOT EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
         WHERE sl.day = v_target_dow
      );

      -- Idempotency: a day that already has an auto match for this sport.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = p_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport.sport_id
           AND m2.match_date = v_target_date
      );

      v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
      v_duration_min  := COALESCE(
        public.parse_match_duration_to_minutes(v_duration_enum::text), 60
      );

      -- Optimize (facility, hour) for this day among the player's favorite
      -- facilities for the sport and their future-valid declared hours. Priority:
      --   1. bookable facilities with courts available — most courts wins;
      --   2. first-come, first-served facilities;
      --   3. anything else. Ties break by nearest facility then earliest hour.
      SELECT cand.facility_id, cand.facility_name, cand.address, cand.hour_of_day
        INTO v_sel
        FROM (
          SELECT f.id AS facility_id, f.name AS facility_name, f.address,
                 sl.hour AS hour_of_day,
                 ( SELECT count(DISTINCT fas.external_court_id)
                     FROM public.facility_availability_snapshot fas
                    WHERE fas.facility_id = f.id
                      AND fas.is_available = TRUE
                      AND (fas.sport_id = v_sport.sport_id OR fas.sport_id IS NULL)
                      AND fas.slot_start =
                          ((v_target_date + make_time(sl.hour, 0, 0))::timestamp
                             AT TIME ZONE v_tz)
                 ) AS court_count,
                 CASE WHEN v_player_loc IS NOT NULL AND f.location IS NOT NULL
                      THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist,
                 f.is_first_come_first_serve AS is_fcfs
            FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
            JOIN public.player_favorite_facility pff
              ON pff.player_id = p_player_id
             AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
            JOIN public.facility f
              ON f.id = pff.facility_id AND f.is_active = TRUE
           WHERE sl.day = v_target_dow
             AND NOT (v_target_date = v_today AND sl.hour <= v_now_hour)
        ) cand
       ORDER BY
         CASE
           WHEN cand.court_count > 0 THEN 0
           WHEN cand.is_fcfs        THEN 1
           ELSE 2
         END ASC,
         cand.court_count DESC,
         cand.dist        ASC NULLS LAST,
         cand.hour_of_day ASC
       LIMIT 1;

      IF FOUND THEN
        v_location_type := 'facility';
        v_court_status  := 'to_reserve';
        v_hour          := v_sel.hour_of_day;
      ELSE
        -- No favorite facility for this sport → TBD location, earliest hour.
        SELECT sl.hour INTO v_hour
          FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
         WHERE sl.day = v_target_dow
           AND NOT (v_target_date = v_today AND sl.hour <= v_now_hour)
         ORDER BY sl.hour ASC
         LIMIT 1;
        CONTINUE WHEN NOT FOUND;  -- no future-valid hour this day
        v_location_type := 'tbd';
        v_court_status  := NULL;
      END IF;

      v_start := make_time(v_hour, 0, 0);
      v_end   := v_start + (v_duration_min || ' minutes')::interval;

      -- Don't stack a planned match on top of a REAL commitment (a match the
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

      v_planned := v_planned + 1;

      plan_weekly_matches_for_player.sport_id            := v_sport.sport_id;
      plan_weekly_matches_for_player.sport_name          := v_sport.sport_name;
      plan_weekly_matches_for_player.match_date          := v_target_date;
      plan_weekly_matches_for_player.start_time          := v_start;
      plan_weekly_matches_for_player.end_time            := v_end;
      plan_weekly_matches_for_player.duration            := v_duration_enum;
      plan_weekly_matches_for_player.match_type          := COALESCE(v_sport.match_type, 'both');
      plan_weekly_matches_for_player.location_type       := v_location_type;
      plan_weekly_matches_for_player.facility_id         := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END;
      plan_weekly_matches_for_player.facility_name       := CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END;
      plan_weekly_matches_for_player.facility_address    := CASE WHEN v_location_type = 'facility' THEN v_sel.address END;
      plan_weekly_matches_for_player.court_status        := v_court_status;
      plan_weekly_matches_for_player.min_rating_score_id := v_sport.min_rating_score_id;
      plan_weekly_matches_for_player.min_rating_label    := v_sport.min_rating_label;
      RETURN NEXT;
    END LOOP;

    EXIT day_loop WHEN v_planned >= v_to_create;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) IS
  'PURE planner (zero writes): the selection half of '
  'generate_weekly_matches_for_player parameterized on declared p_slots '
  '[{day,hour}] instead of saved player_availability. Rolling window '
  'today…today+3 (FOR d IN 0..3 — EXACT local dates, do not widen), '
  'SOONEST-FIRST, capped at the weekly goal minus committed games, one per '
  '(sport, day), favorite facility/hour by tier (bookable-with-courts > FCFS > '
  'rest, nearest then earliest) or TBD. No auto_create_matches gate — callers '
  'gate. Shared by get_checkin_match_plan (preview) and the generator.';

REVOKE ALL ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int) TO service_role;


-- -----------------------------------------------------------------------------
-- 4. Insert helper — the write half of the generator, shared with the
--    confirmed-plan execution path in record_weekly_checkin (next migration).
--    Values are identical to the 20260620120000 INSERT: public, REQUEST-to-join
--    (the host approves every joiner — do not flip to 'direct', see that
--    migration's header), singles, is_auto_generated = TRUE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_weekly_match(
  p_player_id           uuid,
  p_sport_id            uuid,
  p_match_date          date,
  p_start               time without time zone,
  p_end                 time without time zone,
  p_duration            match_duration_enum,
  p_match_type          match_type_enum,
  p_location_type       text,
  p_facility_id         uuid,
  p_facility_name       varchar,
  p_facility_address    text,
  p_court_status        text,
  p_min_rating_score_id uuid,
  p_tz                  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match_id uuid;
BEGIN
  INSERT INTO public.match (
    sport_id, match_date, start_time, end_time, created_by,
    visibility, join_mode, format, player_expectation, duration,
    location_type, facility_id, location_name, location_address,
    court_status, min_rating_score_id, is_auto_generated, timezone
  ) VALUES (
    p_sport_id, p_match_date, p_start, p_end, p_player_id,
    'public', 'request', 'singles', COALESCE(p_match_type, 'both'), p_duration,
    p_location_type::location_type_enum,
    CASE WHEN p_location_type = 'facility' THEN p_facility_id END,
    CASE WHEN p_location_type = 'facility' THEN p_facility_name END,
    CASE WHEN p_location_type = 'facility' THEN p_facility_address END,
    p_court_status::court_status_enum,
    p_min_rating_score_id, TRUE, p_tz
  )
  RETURNING id INTO v_match_id;

  INSERT INTO public.match_participant (
    match_id, player_id, team_number, is_host, status, joined_at
  ) VALUES (
    v_match_id, p_player_id, 1, TRUE, 'joined', now()
  )
  ON CONFLICT ON CONSTRAINT match_participant_match_id_player_id_key DO NOTHING;

  RETURN v_match_id;
END;
$$;

COMMENT ON FUNCTION public.create_weekly_match(uuid, uuid, date, time, time, match_duration_enum, match_type_enum, text, uuid, varchar, text, text, uuid, text) IS
  'Write half of weekly auto-match creation (match + host participant), shared '
  'by generate_weekly_matches_for_player and the confirmed-plan path in '
  'record_weekly_checkin. Always public / request-to-join / singles / '
  'is_auto_generated = TRUE.';

REVOKE ALL ON FUNCTION public.create_weekly_match(uuid, uuid, date, time, time, match_duration_enum, match_type_enum, text, uuid, varchar, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_weekly_match(uuid, uuid, date, time, time, match_duration_enum, match_type_enum, text, uuid, varchar, text, text, uuid, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 5. Legacy generator, rewritten as planner + creator. Same signature, return
--    shape and ACL as 20260620120000; behavior preserved for the cron sweep,
--    generate_weekly_matches_for_all_players, and clients that don't send a
--    plan. The auto_create_matches gate moves HERE (out of the planner).
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
  v_tz          text;
  v_auto_create boolean;
  v_slots       jsonb;
  v_plan        record;
BEGIN
  -- Gate: must have opted in to auto-create.
  SELECT pref.auto_create_matches INTO v_auto_create
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = p_player_id;
  IF v_auto_create IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p
   WHERE p.id = p_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  -- The autonomous path plans from SAVED availability (the wizard persists the
  -- grid before dispatching, so this matches what the player just declared).
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('day', pa.day, 'hour', pa.hour_of_day)),
           '[]'::jsonb
         )
    INTO v_slots
    FROM public.player_availability pa
   WHERE pa.player_id = p_player_id
     AND pa.is_active = TRUE;

  FOR v_plan IN
    SELECT * FROM public.plan_weekly_matches_for_player(p_player_id, v_slots, NULL)
  LOOP
    match_id := public.create_weekly_match(
      p_player_id, v_plan.sport_id, v_plan.match_date, v_plan.start_time,
      v_plan.end_time, v_plan.duration, v_plan.match_type, v_plan.location_type,
      v_plan.facility_id, v_plan.facility_name, v_plan.facility_address,
      v_plan.court_status, v_plan.min_rating_score_id, v_tz
    );
    sport_name    := v_plan.sport_name;
    generate_weekly_matches_for_player.match_date := v_plan.match_date;
    generate_weekly_matches_for_player.start_time := v_plan.start_time;
    generate_weekly_matches_for_player.end_time   := v_plan.end_time;
    facility_name := v_plan.facility_name;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_matches_for_player(uuid) IS
  'Autonomous auto-match path (cron sweep + clients that don''t send a plan): '
  'plan_weekly_matches_for_player over SAVED availability, then '
  'create_weekly_match per proposal. Gated on auto_create_matches. Selection '
  'rules (rolling 0..3 window, goal cap, facility tiering, idempotency, '
  'conflict guard) documented on the planner. Host approves every joiner '
  '(request-to-join).';

REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_player(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_player(uuid) TO service_role;


-- -----------------------------------------------------------------------------
-- 6. Preview RPC — what the wizard's plan step renders. Authenticated: the
--    host is always auth.uid(). One jsonb document: resolved goal, committed
--    count, opt-out state, and the proposals with their named invitees.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_checkin_match_plan(
  p_slots          jsonb,
  p_frequency_goal smallint DEFAULT NULL,
  p_timezone       text     DEFAULT NULL,
  p_max_invitees   int      DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_player_id uuid := auth.uid();
  v_tz        text;
  v_today     date;
  v_week      date;
  v_goal      int;
  v_committed int;
  v_opted_out boolean;
  v_plan      record;
  v_invitees  jsonb;
  v_proposals jsonb := '[]'::jsonb;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- Lazily sync the player timezone (mirrors get_check_in_context).
  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz    := COALESCE(v_tz, 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_week  := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  -- Resolved goal + committed count, mirrored from the planner so the client
  -- can render goal progress ("these N games + M booked get you to your goal").
  v_goal := p_frequency_goal;
  IF v_goal IS NULL THEN
    SELECT wc.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin wc
     WHERE wc.player_id = v_player_id AND wc.week_start_date = v_week;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = v_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  SELECT count(DISTINCT m.id) INTO v_committed
    FROM public.match m
    JOIN public.match_participant mp ON mp.match_id = m.id
   WHERE mp.player_id = v_player_id
     AND mp.status IN ('joined', 'requested', 'waitlisted')
     AND m.cancelled_at IS NULL
     AND m.match_date BETWEEN v_today AND v_today + 3;

  SELECT NOT COALESCE(pref.auto_create_matches, TRUE) INTO v_opted_out
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;
  v_opted_out := COALESCE(v_opted_out, FALSE);

  FOR v_plan IN
    SELECT * FROM public.plan_weekly_matches_for_player(v_player_id, p_slots, v_goal)
  LOOP
    -- Named invitees for this proposal. TBD slots yield [] by design (a TBD
    -- match has no facility to share, so production invites nobody either).
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object(
               'player_id',        c.player_id,
               'first_name',       c.first_name,
               'last_name',        c.last_name,
               'avatar_url',       c.avatar_url,
               'rating_label',     c.rating_label,
               'reputation_score', c.reputation_score,
               'reputation_tier',  c.reputation_tier
             )),
             '[]'::jsonb
           )
      INTO v_invitees
      FROM public.get_auto_invite_candidates_for_slot(
             v_player_id, v_plan.sport_id, v_plan.facility_id, v_plan.match_date,
             v_plan.start_time, v_plan.end_time, NULL, v_plan.match_type,
             p_max_invitees) c;

    v_proposals := v_proposals || jsonb_build_object(
      'key',              v_plan.sport_id::text || ':' || v_plan.match_date::text,
      'sport_id',         v_plan.sport_id,
      'sport_name',       v_plan.sport_name,
      'match_date',       v_plan.match_date,
      'start_time',       v_plan.start_time,
      'end_time',         v_plan.end_time,
      'start_hour',       EXTRACT(hour FROM v_plan.start_time)::int,
      'duration',         v_plan.duration,
      'location_type',    v_plan.location_type,
      'facility_id',      v_plan.facility_id,
      'facility_name',    v_plan.facility_name,
      'facility_address', v_plan.facility_address,
      'min_rating_label', v_plan.min_rating_label,
      'invitees',         v_invitees
    );
  END LOOP;

  RETURN jsonb_build_object(
    'goal',            v_goal,
    'committed_count', COALESCE(v_committed, 0),
    'opted_out',       v_opted_out,
    'proposals',       v_proposals
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) IS
  'Check-in wizard plan PREVIEW: the games plan_weekly_matches_for_player would '
  'create for the caller from the just-declared (unsaved) p_slots [{day,hour}] '
  'and chosen goal, each with its named invite candidates '
  '(get_auto_invite_candidates_for_slot). Read-only. The client submits the '
  'confirmed selection back through record_weekly_checkin(p_match_plan).';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) TO authenticated, service_role;
