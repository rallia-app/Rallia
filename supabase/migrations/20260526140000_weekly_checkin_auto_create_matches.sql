-- =============================================================================
-- Weekly check-in: automatic match creation (auto_create only)
--
-- Reworks the legacy auto-generation path so it honors the weekly check-in
-- model instead of the obsolete period-based availability schema.
--
-- Behaviour
--   • Gate: player_check_in_preferences.auto_create_matches = TRUE.
--   • One OPEN match per distinct available day, FOR EACH of the player's
--     active sports (tennis + pickleball → a match of each per day, and both
--     may share the same hour — these are open invites, not the player's own
--     bookings). No frequency-goal cap — coverage is bounded by availability.
--     Idempotent per ISO week: a (sport, day) that already has an auto-match
--     is skipped. Auto-matches never stack on a REAL commitment, though.
--   • Matches are HOSTED BY the checking-in player, public, join_mode=request
--     (joiners need host approval — no silent auto-join), singles, and
--     is_auto_generated. No opponent pairing; auto_invite is out of scope.
--   • Fits the player's preferences per sport: match type and duration from
--     player_sport. Per day, the (favorite facility, hour) is chosen by tier:
--     bookable-with-courts-available first (most courts), then first-come-
--     first-served facilities, then the rest; ties break by nearest facility
--     then earliest hour. Falls back to nearest/earliest when there's no court
--     data, or TBD when the player has no favorite facility for the sport.
--   • Timezone-aware: week math + match timezone use player.timezone.
--
-- Trigger model
--   record_weekly_checkin upserts player_weekly_checkin. An AFTER INSERT
--   trigger (fires only on the first check-in of a given week — ON CONFLICT
--   DO UPDATE does not fire INSERT triggers) dispatches the
--   generate-weekly-matches edge function via pg_net. net.http_post only
--   enqueues and flushes post-commit, so the check-in write is never blocked.
--   Dispatch failures are swallowed so they can never roll back a check-in.
-- =============================================================================

-- Drop legacy signatures (param shapes change).
DROP FUNCTION IF EXISTS public.generate_weekly_matches_for_player(uuid, integer);
DROP FUNCTION IF EXISTS public.generate_weekly_matches_for_all_players(integer);
DROP FUNCTION IF EXISTS public.trigger_weekly_match_generation(integer);

-- -----------------------------------------------------------------------------
-- generate_weekly_matches_for_player — open matches for one checked-in player
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
-- `extensions` on the path so the PostGIS geography type + ST_Distance resolve.
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tz            text;
  v_today         date;
  v_week_start    date;        -- player-local Monday of the current ISO week
  v_now_hour      int;
  v_auto_create   boolean;
  v_player_loc    extensions.geography;
  v_sport         record;
  v_sel           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_hour          int;
  v_start         time;
  v_end           time;
  v_match_id      uuid;
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
           ps.preferred_match_type      AS match_type
      FROM public.player_sport ps
      JOIN public.sport s ON s.id = ps.sport_id
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

    -- NOTE: min_rating_score_id is intentionally left unset (matches open to all
    -- levels). A player-selected "active rating per sport" is separate work;
    -- once that lands, derive the match minimum from it here.

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
        court_status, is_auto_generated, timezone
      ) VALUES (
        v_sport.sport_id, v_target_date, v_start, v_end, p_player_id,
        'public', 'request', 'singles', COALESCE(v_sport.match_type, 'both'), v_duration_enum,
        v_location_type::location_type_enum,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_id END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.facility_name END,
        CASE WHEN v_location_type = 'facility' THEN v_sel.address END,
        v_court_status::court_status_enum,
        TRUE, v_tz
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
  'hosted by the player. Per day it picks the favorite facility/hour by tier: '
  'bookable-with-courts-available (most courts) > first-come-first-served > rest, '
  'tie-broken by nearest then earliest; falls back to nearest/earliest, or TBD '
  'when no favorites. Gated on auto_create_matches. Idempotent per week.';

-- -----------------------------------------------------------------------------
-- generate_weekly_matches_for_all_players — batch sweep (manual/admin/backfill)
-- Only processes players who checked in this week AND opted into auto-create.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_weekly_matches_for_all_players()
RETURNS TABLE (
  player_id       uuid,
  player_name     text,
  matches_created integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player      record;
  v_match_count int;
BEGIN
  FOR v_player IN
    SELECT p.id, pr.display_name
      FROM public.player p
      JOIN public.profile pr ON pr.id = p.id
      JOIN public.player_check_in_preferences pref
        ON pref.player_id = p.id AND pref.auto_create_matches = TRUE
     WHERE pr.is_active = TRUE
       AND EXISTS (
         SELECT 1
           FROM public.player_weekly_checkin wc
          WHERE wc.player_id = p.id
            AND wc.week_start_date = date_trunc(
                  'week',
                  (now() AT TIME ZONE COALESCE(NULLIF(p.timezone, ''), 'UTC'))
                )::date
       )
  LOOP
    SELECT COUNT(*) INTO v_match_count
      FROM public.generate_weekly_matches_for_player(v_player.id);

    player_id       := v_player.id;
    player_name     := v_player.display_name;
    matches_created := v_match_count;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_matches_for_all_players() IS
  'Batch auto-create sweep for every player who checked in this week with '
  'auto_create_matches on. Per-player logic lives in '
  'generate_weekly_matches_for_player.';

-- Admin/test convenience wrapper (kept for parity with the legacy helper).
CREATE OR REPLACE FUNCTION public.trigger_weekly_match_generation()
RETURNS TABLE (
  player_id       uuid,
  player_name     text,
  matches_created integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.generate_weekly_matches_for_all_players();
$$;

COMMENT ON FUNCTION public.trigger_weekly_match_generation() IS
  'Manual trigger for the weekly auto-create sweep — useful for testing/admin.';

-- These functions create matches on a player's behalf; keep them server-side
-- only (edge function via service_role, or the trigger).
REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_player(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_weekly_matches_for_all_players()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_weekly_match_generation()          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_player(uuid)  TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_weekly_matches_for_all_players() TO service_role;
GRANT EXECUTE ON FUNCTION public.trigger_weekly_match_generation()         TO service_role;

-- -----------------------------------------------------------------------------
-- Trigger: dispatch the edge function (non-blocking) on first check-in of week
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_dispatch_weekly_match_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fire-and-forget: net.http_post only enqueues and flushes after commit, so
  -- this never blocks the check-in transaction. Auth pattern mirrors the
  -- existing pg_cron jobs (apikey header validated by requireSecretApikey).
  PERFORM net.http_post(
    url := (
      SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name = 'supabase_functions_url' LIMIT 1
    ) || '/functions/v1/generate-weekly-matches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body := jsonb_build_object('player_id', NEW.player_id::text),
    timeout_milliseconds := 30000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A dispatch failure must never roll back the player's check-in.
  RAISE WARNING 'tg_dispatch_weekly_match_generation: dispatch failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_weekly_match_generation ON public.player_weekly_checkin;
CREATE TRIGGER trg_dispatch_weekly_match_generation
  AFTER INSERT ON public.player_weekly_checkin
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_dispatch_weekly_match_generation();
