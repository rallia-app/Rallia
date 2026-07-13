-- =============================================================================
-- Weekly check-in: per-SPORT playing objective + streaks
--
-- Follow-up to 20260713160000 (sport-scoped opportunities/plan). The weekly
-- frequency goal and the streak were still player-wide; they now live per
-- (player, sport), matching the app's sport-mode separation:
--
--   * player_streak            → PK (player_id, sport_id); each sport has its
--                                 own streak, longest, freeze inventory + cap.
--   * player_weekly_checkin    → PK (player_id, sport_id, week_start_date);
--                                 one goal per sport per ISO week.
--   * Existing rows backfill to the player's primary (else most recent active)
--     sport; rows for players with no player_sport row are dropped.
--
-- Function changes (old signatures dropped — no ambiguous overloads):
--   * get_check_in_context(+p_sport_id)      — streak/goal/history/freq-set for
--     that sport; NULL resolves to the primary sport (old clients). Coverage,
--     pending flag, timezone and window stay player-wide.
--   * record_weekly_checkin(+p_sport_id)     — goal + streak row per sport;
--     NULL resolves to the primary sport. Prefs stay player-wide.
--   * evaluate_weekly_goals()                — folds each (player, sport) streak
--     independently; sessions counted per sport.
--   * count_player_sessions_for_week(+sport) — optional sport filter.
--   * count_checkin_window_committed_matches(+sport) — optional sport filter,
--     so one sport's booked games don't eat another sport's goal cap.
--   * plan_weekly_matches_for_player / get_checkin_match_plan — goal lookup is
--     sport-scoped when p_sport_id is set; agnostic calls use the SUM of the
--     week's sport goals (total games target) and the all-sports committed
--     count, keeping the legacy cron generator coherent.
-- =============================================================================


-- =============================================================================
-- 1. player_streak → per (player, sport)
-- =============================================================================

ALTER TABLE public.player_streak
  ADD COLUMN IF NOT EXISTS sport_id UUID REFERENCES public.sport(id) ON DELETE CASCADE;

UPDATE public.player_streak st
   SET sport_id = sub.sport_id
  FROM (
    SELECT DISTINCT ON (ps.player_id) ps.player_id, ps.sport_id
      FROM public.player_sport ps
     ORDER BY ps.player_id, ps.is_active DESC, ps.is_primary DESC NULLS LAST, ps.updated_at DESC
  ) sub
 WHERE sub.player_id = st.player_id
   AND st.sport_id IS NULL;

-- A streak row for a player with no player_sport row can't be attributed (and
-- that player can't check in anymore anyway — the RPC now requires a sport).
DELETE FROM public.player_streak WHERE sport_id IS NULL;

ALTER TABLE public.player_streak ALTER COLUMN sport_id SET NOT NULL;
ALTER TABLE public.player_streak DROP CONSTRAINT player_streak_pkey;
ALTER TABLE public.player_streak ADD PRIMARY KEY (player_id, sport_id);

COMMENT ON TABLE public.player_streak IS
  'Per-(player, sport) streak state. Read by the wizard cold-start and the Home banner (scoped to the selected sport mode). Written by record_weekly_checkin and the hourly evaluate_weekly_goals cron.';


-- =============================================================================
-- 2. player_weekly_checkin → per (player, sport, week)
-- =============================================================================

ALTER TABLE public.player_weekly_checkin
  ADD COLUMN IF NOT EXISTS sport_id UUID REFERENCES public.sport(id) ON DELETE CASCADE;

UPDATE public.player_weekly_checkin c
   SET sport_id = sub.sport_id
  FROM (
    SELECT DISTINCT ON (ps.player_id) ps.player_id, ps.sport_id
      FROM public.player_sport ps
     ORDER BY ps.player_id, ps.is_active DESC, ps.is_primary DESC NULLS LAST, ps.updated_at DESC
  ) sub
 WHERE sub.player_id = c.player_id
   AND c.sport_id IS NULL;

DELETE FROM public.player_weekly_checkin WHERE sport_id IS NULL;

ALTER TABLE public.player_weekly_checkin ALTER COLUMN sport_id SET NOT NULL;
ALTER TABLE public.player_weekly_checkin DROP CONSTRAINT player_weekly_checkin_pkey;
ALTER TABLE public.player_weekly_checkin ADD PRIMARY KEY (player_id, sport_id, week_start_date);

DROP INDEX IF EXISTS public.idx_player_weekly_checkin_player_recent;
CREATE INDEX IF NOT EXISTS idx_player_weekly_checkin_player_sport_recent
  ON public.player_weekly_checkin (player_id, sport_id, week_start_date DESC);

COMMENT ON TABLE public.player_weekly_checkin IS
  'Audit log: one row per (player, sport) per ISO week. Drives the sport-scoped goal-hit history strip and the frequency-already-set gate.';


-- =============================================================================
-- 3. count_player_sessions_for_week — optional sport filter
-- =============================================================================

DROP FUNCTION IF EXISTS public.count_player_sessions_for_week(uuid, date);

CREATE FUNCTION public.count_player_sessions_for_week(
  p_player_id  uuid,
  p_week_start date,
  p_sport_id   uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM public.qualifying_played_game q
  WHERE q.player_id = p_player_id
    AND q.match_date >= p_week_start
    AND q.match_date <  p_week_start + 7
    AND (p_sport_id IS NULL OR q.sport_id = p_sport_id);
$$;

COMMENT ON FUNCTION public.count_player_sessions_for_week(uuid, date, uuid) IS
  'Number of qualifying games for the player in the given ISO week, optionally '
  'restricted to one sport (per-sport streak evaluation). Thin wrapper over the '
  'canonical qualifying_played_game view.';

GRANT EXECUTE ON FUNCTION public.count_player_sessions_for_week(uuid, date, uuid)
  TO authenticated, service_role;


-- =============================================================================
-- 4. count_checkin_window_committed_matches — optional sport filter
-- =============================================================================

DROP FUNCTION IF EXISTS public.count_checkin_window_committed_matches(uuid, date);

CREATE FUNCTION public.count_checkin_window_committed_matches(
  p_player_id uuid,
  p_today     date,
  p_sport_id  uuid DEFAULT NULL
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT m.id)::int
    FROM public.match m
    JOIN public.match_participant mp ON mp.match_id = m.id
   WHERE mp.player_id = p_player_id
     AND mp.status IN ('joined', 'requested', 'waitlisted')
     AND m.cancelled_at IS NULL
     AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.match_result mr WHERE mr.match_id = m.id
     )
     AND m.match_date BETWEEN p_today AND p_today + 3
     -- Hasn't ended yet (same end-time rule as get_player_matches upcoming).
     AND (
       CASE
         WHEN m.timezone IS NOT NULL THEN
           CASE
             WHEN m.end_time < m.start_time THEN
               timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= now()
             ELSE
               timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= now()
           END
         ELSE
           CASE
             WHEN m.end_time < m.start_time THEN
               ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (now() AT TIME ZONE 'UTC')::timestamp
             ELSE
               (m.match_date + m.end_time)::timestamp >= (now() AT TIME ZONE 'UTC')::timestamp
           END
       END
     )
     -- Not expired: start still in the future OR the match is full.
     AND (
       (
         CASE
           WHEN m.timezone IS NOT NULL THEN
             timezone(m.timezone, (m.match_date + m.start_time)::timestamp) >= now()
           ELSE
             (m.match_date + m.start_time)::timestamp >= (now() AT TIME ZONE 'UTC')::timestamp
         END
       )
       OR (
         SELECT count(*)::int
           FROM public.match_participant mp2
          WHERE mp2.match_id = m.id
            AND mp2.status = 'joined'
       ) >= CASE m.format WHEN 'doubles' THEN 4 ELSE 2 END
     );
$$;

COMMENT ON FUNCTION public.count_checkin_window_committed_matches(uuid, date, uuid) IS
  'Games already lined up in the check-in rolling window (today…today+3) that '
  'count toward the weekly goal cap, optionally restricted to one sport (so one '
  'sport''s bookings don''t consume another sport''s goal). Mirrors '
  'get_player_matches upcoming semantics.';

REVOKE ALL ON FUNCTION public.count_checkin_window_committed_matches(uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_checkin_window_committed_matches(uuid, date, uuid) TO service_role;


-- =============================================================================
-- 5. evaluate_weekly_goals — fold each (player, sport) streak independently
-- =============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_weekly_goals()
RETURNS TABLE (
  players_evaluated int,
  weeks_evaluated   int,
  hits              int,
  misses            int,
  rescued           int,
  resets            int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p          record;
  v_cur_week date;
  v_target   date;
  v_goal     smallint;
  v_sessions int;
  v_streak   smallint;
  v_freezes  smallint;
  v_cap      smallint;
  v_longest  smallint;
  v_hit      boolean;
  v_did_any  boolean;
  v_players  int := 0;
  v_weeks    int := 0;
  v_hits     int := 0;
  v_misses   int := 0;
  v_rescued  int := 0;
  v_resets   int := 0;
BEGIN
  FOR p IN
    SELECT ps.player_id, ps.sport_id, ps.current_streak, ps.longest_streak,
           ps.freeze_inventory, ps.freeze_cap, ps.last_evaluated_week_start
    FROM public.player_streak ps
  LOOP
    v_cur_week := public.player_current_week_start(p.player_id);
    -- First un-evaluated week. NULL watermark → only the last completed week.
    v_target   := COALESCE(p.last_evaluated_week_start, v_cur_week - 14) + 7;
    v_streak   := p.current_streak;
    v_freezes  := p.freeze_inventory;
    v_cap      := p.freeze_cap;
    v_longest  := p.longest_streak;
    v_did_any  := FALSE;

    -- Fold each COMPLETED week (strictly before the current local week).
    WHILE v_target < v_cur_week LOOP
      v_goal := NULL;  -- reset: SELECT INTO leaves the var unchanged on no row
      SELECT c.frequency_goal INTO v_goal
      FROM public.player_weekly_checkin c
      WHERE c.player_id = p.player_id
        AND c.sport_id = p.sport_id
        AND c.week_start_date = v_target;

      v_sessions := public.count_player_sessions_for_week(p.player_id, v_target, p.sport_id);

      -- Backfill the historical sessions count if a check-in row exists.
      UPDATE public.player_weekly_checkin
         SET sessions_played = v_sessions
       WHERE player_id = p.player_id
         AND sport_id = p.sport_id
         AND week_start_date = v_target;

      v_hit := (v_goal IS NOT NULL AND v_sessions >= v_goal);

      IF v_hit THEN
        v_streak := v_streak + 1;
        v_hits := v_hits + 1;
        -- Milestone: a freeze every 4th consecutive goal-hit week (capped).
        IF v_streak % 4 = 0 AND v_freezes < v_cap THEN
          v_freezes := v_freezes + 1;
        END IF;
      ELSE
        v_misses := v_misses + 1;
        IF v_freezes > 0 THEN
          v_freezes := v_freezes - 1;  -- freeze auto-rescues the miss
          v_rescued := v_rescued + 1;
          -- Record the rescue on the week row (if any) so the history strip
          -- can render ❄️ for a miss that did not break the streak.
          UPDATE public.player_weekly_checkin
             SET freeze_used = TRUE
           WHERE player_id = p.player_id
             AND sport_id = p.sport_id
             AND week_start_date = v_target;
        ELSE
          v_streak := 0;
          v_resets := v_resets + 1;
        END IF;
      END IF;

      v_longest := GREATEST(v_longest, v_streak);
      v_weeks   := v_weeks + 1;
      v_did_any := TRUE;
      v_target  := v_target + 7;
    END LOOP;

    IF v_did_any THEN
      UPDATE public.player_streak
         SET current_streak            = v_streak,
             longest_streak            = v_longest,
             freeze_inventory          = v_freezes,
             last_evaluated_week_start = v_target - 7,  -- last week we folded in
             updated_at                = now()
       WHERE player_id = p.player_id
         AND sport_id = p.sport_id;
      v_players := v_players + 1;
    END IF;
  END LOOP;

  players_evaluated := v_players;
  weeks_evaluated   := v_weeks;
  hits              := v_hits;
  misses            := v_misses;
  rescued           := v_rescued;
  resets            := v_resets;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.evaluate_weekly_goals() IS
  'Hourly week-end evaluator. Folds every COMPLETED, un-evaluated ISO week into '
  'each (player, sport) streak independently: sessions counted per sport, goal '
  'read from the sport''s check-in row, freezes per sport. players_evaluated '
  'counts (player, sport) streak rows advanced.';

REVOKE ALL ON FUNCTION public.evaluate_weekly_goals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_weekly_goals() TO service_role;


-- =============================================================================
-- 6. get_check_in_context — sport-scoped streak/goal/history
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_check_in_context(TEXT);
DROP FUNCTION IF EXISTS public.get_check_in_context(TEXT, UUID);

CREATE FUNCTION public.get_check_in_context(
  p_timezone TEXT DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  current_streak                  SMALLINT,
  longest_streak                  SMALLINT,
  freeze_inventory                SMALLINT,
  freeze_cap                      SMALLINT,
  last_week_frequency_goal        SMALLINT,
  last_week_sessions_played       SMALLINT,
  history_weeks                   JSONB,
  last_frequency_goal             SMALLINT,
  is_pending_check_in             BOOLEAN,
  timezone                        TEXT,
  availability_covered_through    DATE,
  frequency_already_set_this_week BOOLEAN,
  checkin_window                  JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id   UUID := auth.uid();
  v_sport_id    UUID := p_sport_id;
  v_tz          TEXT;
  v_today       DATE;
  v_this_week   DATE;
  v_last_week   DATE;
  v_covered     DATE;
  v_pending     BOOLEAN;
  v_freq_set    BOOLEAN;
  v_window      JSONB;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

  -- NULL sport (old clients / sport mode still resolving) → the primary sport,
  -- else the most recently touched active sport.
  IF v_sport_id IS NULL THEN
    SELECT ps.sport_id INTO v_sport_id
      FROM public.player_sport ps
     WHERE ps.player_id = v_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
     LIMIT 1;
  END IF;

  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  v_today     := (now() AT TIME ZONE v_tz)::date;
  v_this_week := date_trunc('week', (now() AT TIME ZONE v_tz))::date;
  v_last_week := v_this_week - INTERVAL '7 days';

  -- Availability coverage stays player-wide (the schedule is the schedule).
  SELECT pref.availability_covered_through INTO v_covered
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;

  v_pending := (v_covered IS NULL) OR (v_today > v_covered);

  -- The goal is asked once per ISO week PER SPORT.
  v_freq_set := EXISTS (
    SELECT 1 FROM public.player_weekly_checkin c
     WHERE c.player_id = v_player_id
       AND c.sport_id = v_sport_id
       AND c.week_start_date = v_this_week
       AND c.frequency_goal IS NOT NULL
  );

  SELECT jsonb_agg(
           jsonb_build_object(
             'date', (v_today + gs.i)::text,
             'day_of_week', (CASE EXTRACT(isodow FROM (v_today + gs.i))::int
                               WHEN 1 THEN 'monday'    WHEN 2 THEN 'tuesday'
                               WHEN 3 THEN 'wednesday' WHEN 4 THEN 'thursday'
                               WHEN 5 THEN 'friday'    WHEN 6 THEN 'saturday'
                               WHEN 7 THEN 'sunday' END)
           ) ORDER BY gs.i
         )
    INTO v_window
  FROM generate_series(0, 3) AS gs(i);

  RETURN QUERY
  WITH streak AS (
    SELECT s.current_streak    AS cs_current_streak,
           s.longest_streak    AS cs_longest_streak,
           s.freeze_inventory  AS cs_freeze_inventory,
           s.freeze_cap        AS cs_freeze_cap
    FROM public.player_streak s
    WHERE s.player_id = v_player_id
      AND s.sport_id = v_sport_id
  ),
  last_week_row AS (
    SELECT c.frequency_goal   AS lw_frequency_goal,
           c.sessions_played  AS lw_sessions_played
    FROM public.player_weekly_checkin c
    WHERE c.player_id = v_player_id
      AND c.sport_id = v_sport_id
      AND c.week_start_date = v_last_week
      AND c.sessions_played IS NOT NULL   -- only show an evaluated last week
  ),
  -- One row per each of the last 4 COMPLETED weeks (newest-first), resolved to a
  -- status by the week's REAL date. A week with no check-in row → 'none'.
  history AS (
    SELECT jsonb_agg(
             jsonb_build_object(
               'week_start', g.wk,
               'status', CASE
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                      AND c.sessions_played >= c.frequency_goal           THEN 'hit'
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                      AND COALESCE(c.freeze_used, FALSE)                  THEN 'frozen'
                 WHEN c.frequency_goal IS NOT NULL AND c.sessions_played IS NOT NULL
                                                                          THEN 'miss'
                 ELSE 'none'
               END
             )
             ORDER BY g.wk DESC
           ) AS weeks
    FROM (
      SELECT (v_this_week - (n || ' weeks')::interval)::date AS wk
      FROM generate_series(1, 4) AS n
    ) g
    LEFT JOIN public.player_weekly_checkin c
      ON c.player_id = v_player_id
     AND c.sport_id = v_sport_id
     AND c.week_start_date = g.wk
  ),
  -- Pre-select for the goal pill: the sport's most recent declared goal, falling
  -- back to the player-wide last-used goal for a sport with no history yet.
  last_goal AS (
    SELECT COALESCE(
             ( SELECT c.frequency_goal
                 FROM public.player_weekly_checkin c
                WHERE c.player_id = v_player_id
                  AND c.sport_id = v_sport_id
                  AND c.frequency_goal IS NOT NULL
                ORDER BY c.week_start_date DESC
                LIMIT 1 ),
             ( SELECT p.last_frequency_goal
                 FROM public.player_check_in_preferences p
                WHERE p.player_id = v_player_id )
           ) AS lg_last_frequency_goal
  )
  SELECT
    COALESCE((SELECT cs_current_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_longest_streak    FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_inventory  FROM streak), 0::SMALLINT),
    COALESCE((SELECT cs_freeze_cap        FROM streak), 2::SMALLINT),
    (SELECT lw_frequency_goal             FROM last_week_row),
    (SELECT lw_sessions_played            FROM last_week_row),
    COALESCE((SELECT weeks                FROM history), '[]'::jsonb),
    (SELECT lg_last_frequency_goal        FROM last_goal),
    v_pending,
    v_tz,
    v_covered,
    v_freq_set,
    v_window;
END;
$$;

COMMENT ON FUNCTION public.get_check_in_context(TEXT, UUID) IS
  'Check-in wizard cold-start. Streak, goal history, last-week recap and the '
  'frequency-already-set gate are scoped to p_sport_id (NULL → primary sport). '
  'Availability coverage, pending flag, timezone and window stay player-wide.';

GRANT EXECUTE ON FUNCTION public.get_check_in_context(TEXT, UUID) TO authenticated;


-- =============================================================================
-- 7. record_weekly_checkin — goal + streak row per sport
-- =============================================================================

DROP FUNCTION IF EXISTS public.record_weekly_checkin(smallint, boolean, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.record_weekly_checkin(smallint, boolean, boolean, text, jsonb, uuid);

CREATE FUNCTION public.record_weekly_checkin(
  p_frequency_goal SMALLINT,
  p_auto_create BOOLEAN,
  p_auto_invite BOOLEAN,
  p_timezone TEXT DEFAULT NULL,
  p_match_plan JSONB DEFAULT NULL,
  p_sport_id UUID DEFAULT NULL
)
RETURNS TABLE (
  new_streak        SMALLINT,
  freezes           SMALLINT,
  longest_streak    SMALLINT,
  milestone_reached BOOLEAN,
  freeze_earned     BOOLEAN,
  created_matches   JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_player_id        UUID := auth.uid();
  v_checkin_sport    UUID := p_sport_id;
  v_tz               TEXT;
  v_today            DATE;
  v_now_hour         INT;
  v_covered_through  DATE;
  v_this_week        DATE;
  v_existing         INT;
  v_is_new           BOOLEAN;
  v_cur_streak       SMALLINT;
  v_cur_freezes      SMALLINT;
  v_cur_longest      SMALLINT;
  v_created          JSONB := '[]'::jsonb;
  v_dispatch         JSONB := '[]'::jsonb;
  v_dispatch_body    JSONB;
  v_prop             JSONB;
  v_sport_id         UUID;
  v_match_date       DATE;
  v_start_hour       INT;
  v_facility_id      UUID;
  v_excluded         JSONB;
  v_sport            RECORD;
  v_fac_name         VARCHAR;
  v_fac_address      TEXT;
  v_duration_enum    match_duration_enum;
  v_duration_min     INT;
  v_start            TIME;
  v_end              TIME;
  v_location_type    TEXT;
  v_match_id         UUID;
  v_min_rating       UUID;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;
  IF p_frequency_goal < 1 OR p_frequency_goal > 5 THEN
    RAISE EXCEPTION 'frequency_goal must be 1..5';
  END IF;
  -- Malformed plan = a client bug, not a stale slot: fail loudly.
  IF p_match_plan IS NOT NULL AND (
       jsonb_typeof(p_match_plan) <> 'object'
       OR (p_match_plan->>'version')::int IS DISTINCT FROM 1
       OR jsonb_typeof(p_match_plan->'proposals') <> 'array'
     ) THEN
    RAISE EXCEPTION 'p_match_plan must be {"version":1,"proposals":[...]}';
  END IF;

  -- NULL sport (old clients) → the primary sport, else the most recently
  -- touched active sport. Goal + streak are per sport, so one is required.
  IF v_checkin_sport IS NULL THEN
    SELECT ps.sport_id INTO v_checkin_sport
      FROM public.player_sport ps
     WHERE ps.player_id = v_player_id
       AND ps.is_active = TRUE
     ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
     LIMIT 1;
  END IF;
  IF v_checkin_sport IS NULL THEN
    RAISE EXCEPTION 'record_weekly_checkin: player has no active sport';
  END IF;

  IF p_timezone IS NOT NULL AND length(trim(p_timezone)) > 0 THEN
    UPDATE public.player
       SET timezone = p_timezone
     WHERE id = v_player_id
       AND (player.timezone IS DISTINCT FROM p_timezone);
  END IF;

  SELECT COALESCE(NULLIF(p.timezone, ''), 'UTC') INTO v_tz
    FROM public.player p WHERE p.id = v_player_id;
  v_tz := COALESCE(v_tz, 'UTC');

  v_today           := (now() AT TIME ZONE v_tz)::date;
  v_now_hour        := EXTRACT(hour FROM (now() AT TIME ZONE v_tz))::int;
  v_covered_through := v_today + 3;
  v_this_week       := date_trunc('week', (now() AT TIME ZONE v_tz))::date;

  -- Ensure the sport's streak row exists so the weekly evaluator has something
  -- to evaluate. We DO NOT touch streak values here — the evaluator owns them.
  INSERT INTO public.player_streak (player_id, sport_id, current_streak, longest_streak, freeze_inventory, freeze_cap)
  VALUES (v_player_id, v_checkin_sport, 0, 0, 0, 2)
  ON CONFLICT (player_id, sport_id) DO NOTHING;

  SELECT 1 INTO v_existing
  FROM public.player_weekly_checkin c
  WHERE c.player_id = v_player_id
    AND c.sport_id = v_checkin_sport
    AND c.week_start_date = v_this_week;
  v_is_new := v_existing IS NULL;

  -- Frequency goal is asked ONCE per ISO week per sport: first check-in writes it.
  IF v_is_new THEN
    INSERT INTO public.player_weekly_checkin (player_id, sport_id, week_start_date, frequency_goal, sessions_played, freeze_consumed)
    VALUES (v_player_id, v_checkin_sport, v_this_week, p_frequency_goal, NULL, FALSE);
  END IF;

  -- Preferences stay player-wide; last_frequency_goal is the cross-sport
  -- last-used fallback (per-sport pre-select reads the check-in history).
  INSERT INTO public.player_check_in_preferences
    (player_id, auto_create_matches, auto_invite_players, last_frequency_goal, availability_covered_through, updated_at)
  VALUES
    (v_player_id, p_auto_create, p_auto_invite, p_frequency_goal, v_covered_through, now())
  ON CONFLICT (player_id) DO UPDATE
    SET auto_create_matches          = EXCLUDED.auto_create_matches,
        auto_invite_players          = EXCLUDED.auto_invite_players,
        availability_covered_through = EXCLUDED.availability_covered_through,
        last_frequency_goal          = CASE WHEN v_is_new
                                            THEN EXCLUDED.last_frequency_goal
                                            ELSE public.player_check_in_preferences.last_frequency_goal END,
        updated_at                   = now();

  UPDATE public.player_availability
     SET last_confirmed_at = now()
   WHERE player_id = v_player_id
     AND is_active = TRUE;

  -- ---------------------------------------------------------------------------
  -- Confirmed plan → create the selected matches NOW. Hard-capped at 5 (the max
  -- weekly goal); the player explicitly confirmed this list, so it is NOT
  -- re-netted against the committed count — the guards below catch anything
  -- that became invalid between preview and submit.
  -- ---------------------------------------------------------------------------
  IF p_match_plan IS NOT NULL THEN
    FOR v_prop IN
      SELECT el.value
        FROM jsonb_array_elements(p_match_plan->'proposals') WITH ORDINALITY AS el(value, ord)
       ORDER BY el.ord
       LIMIT 5
    LOOP
      BEGIN
        v_sport_id    := (v_prop->>'sport_id')::uuid;
        v_match_date  := (v_prop->>'match_date')::date;
        v_start_hour  := (v_prop->>'start_hour')::int;
        v_facility_id := NULLIF(v_prop->>'facility_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'record_weekly_checkin: unparseable proposal skipped: %', v_prop;
        CONTINUE;
      END;

      IF v_sport_id IS NULL OR v_match_date IS NULL OR v_start_hour IS NULL THEN
        RAISE WARNING 'record_weekly_checkin: incomplete proposal skipped: %', v_prop;
        CONTINUE;
      END IF;
      IF v_match_date < v_today OR v_match_date > v_today + 3 THEN
        RAISE WARNING 'record_weekly_checkin: proposal outside window skipped (%: %)', v_sport_id, v_match_date;
        CONTINUE;
      END IF;
      IF v_start_hour < 0 OR v_start_hour > 23
         OR (v_match_date = v_today AND v_start_hour <= v_now_hour) THEN
        RAISE WARNING 'record_weekly_checkin: past/invalid hour skipped (%: % %h)', v_sport_id, v_match_date, v_start_hour;
        CONTINUE;
      END IF;

      -- Re-derive everything else from live data (the plan is a selection).
      SELECT ps.preferred_match_duration AS duration,
             ps.preferred_match_type     AS match_type,
             s.name                      AS sport_name,
             prs.rating_score_id         AS min_rating_score_id
        INTO v_sport
        FROM public.player_sport ps
        JOIN public.sport s ON s.id = ps.sport_id
        LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
       WHERE ps.player_id = v_player_id
         AND ps.sport_id  = v_sport_id
         AND ps.is_active = TRUE;
      IF NOT FOUND THEN
        RAISE WARNING 'record_weekly_checkin: inactive sport skipped (%)', v_sport_id;
        CONTINUE;
      END IF;
      v_min_rating := v_sport.min_rating_score_id;

      v_fac_name    := NULL;
      v_fac_address := NULL;
      IF v_facility_id IS NOT NULL THEN
        SELECT f.name, f.address INTO v_fac_name, v_fac_address
          FROM public.facility f
         WHERE f.id = v_facility_id AND f.is_active = TRUE;
        IF NOT FOUND THEN
          RAISE WARNING 'record_weekly_checkin: unknown/inactive facility skipped (%)', v_facility_id;
          CONTINUE;
        END IF;
        v_location_type := 'facility';
      ELSE
        v_location_type := 'tbd';
      END IF;

      -- Idempotency: one auto match per (sport, exact date).
      IF EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = v_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport_id
           AND m2.match_date = v_match_date
      ) THEN
        RAISE WARNING 'record_weekly_checkin: duplicate auto match skipped (%: %)', v_sport_id, v_match_date;
        CONTINUE;
      END IF;

      v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
      v_duration_min  := COALESCE(public.parse_match_duration_to_minutes(v_duration_enum::text), 60);
      v_start         := make_time(v_start_hour, 0, 0);
      v_end           := v_start + (v_duration_min || ' minutes')::interval;

      -- Don't stack onto a REAL commitment (own auto matches exempt) — a game
      -- joined on the "Games for you" step seconds ago counts.
      IF EXISTS (
        SELECT 1
          FROM public.match m
          JOIN public.match_participant mp
            ON mp.match_id = m.id
           AND mp.player_id = v_player_id
           AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
         WHERE m.cancelled_at IS NULL
           AND m.match_date = v_match_date
           AND m.start_time < v_end
           AND m.end_time   > v_start
           AND NOT (m.is_auto_generated = TRUE AND m.created_by = v_player_id)
      ) THEN
        RAISE WARNING 'record_weekly_checkin: conflicting commitment, proposal skipped (%: % %h)', v_sport_id, v_match_date, v_start_hour;
        CONTINUE;
      END IF;

      v_match_id := public.create_weekly_match(
        v_player_id, v_sport_id, v_match_date, v_start, v_end,
        v_duration_enum, v_sport.match_type, v_location_type,
        v_facility_id, v_fac_name, v_fac_address,
        CASE WHEN v_location_type = 'facility' THEN 'to_reserve' END,
        v_min_rating, v_tz
      );

      -- Excluded invitees: uuid-shaped strings only, capped at 100.
      SELECT COALESCE(jsonb_agg(DISTINCT ex.val), '[]'::jsonb)
        INTO v_excluded
        FROM (
          SELECT el.value #>> '{}' AS val
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(v_prop->'invite_excluded_player_ids') = 'array'
                        THEN v_prop->'invite_excluded_player_ids'
                        ELSE '[]'::jsonb END
                 ) el
           LIMIT 100
        ) ex
       WHERE ex.val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

      v_created := v_created || jsonb_build_object(
        'match_id',      v_match_id,
        'sport_id',      v_sport_id,
        'sport_name',    v_sport.sport_name,
        'match_date',    v_match_date,
        'start_time',    v_start,
        'end_time',      v_end,
        'facility_name', CASE WHEN v_location_type = 'facility' THEN v_fac_name END,
        'location_type', v_location_type
      );
      v_dispatch := v_dispatch || jsonb_build_object(
        'match_id',            v_match_id,
        'sport_name',          v_sport.sport_name,
        'match_date',          v_match_date,
        'start_time',          v_start,
        'end_time',            v_end,
        'facility_name',       CASE WHEN v_location_type = 'facility' THEN v_fac_name END,
        'excluded_player_ids', v_excluded
      );
    END LOOP;
  END IF;

  -- Dispatch (fire-and-forget). Plan path → invite-only body with the matches
  -- just created (skipped entirely when nothing was created — nothing to
  -- invite). Legacy path → {player_id}, the edge function generates + invites.
  IF p_match_plan IS NULL THEN
    v_dispatch_body := jsonb_build_object('player_id', v_player_id::text);
  ELSIF jsonb_array_length(v_dispatch) > 0 THEN
    v_dispatch_body := jsonb_build_object('player_id', v_player_id::text, 'matches', v_dispatch);
  ELSE
    v_dispatch_body := NULL;
  END IF;

  IF v_dispatch_body IS NOT NULL THEN
    BEGIN
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
        body := v_dispatch_body,
        timeout_milliseconds := 30000
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'record_weekly_checkin: match-generation dispatch failed: %', SQLERRM;
    END;
  END IF;

  -- Return the sport's CURRENT streak unchanged — the check-in doesn't move it
  -- (evaluate_weekly_goals owns streak math).
  SELECT s.current_streak, s.freeze_inventory, s.longest_streak
    INTO v_cur_streak, v_cur_freezes, v_cur_longest
  FROM public.player_streak s
  WHERE s.player_id = v_player_id
    AND s.sport_id = v_checkin_sport;

  new_streak        := COALESCE(v_cur_streak, 0);
  freezes           := COALESCE(v_cur_freezes, 0);
  longest_streak    := COALESCE(v_cur_longest, 0);
  milestone_reached := FALSE;
  freeze_earned     := FALSE;
  created_matches   := v_created;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB, UUID) IS
  'Rolling-window check-in, scoped to p_sport_id (NULL → primary sport). Syncs '
  'tz, sets availability_covered_through = today+3 (player-wide), asks '
  'frequency_goal once per ISO week PER SPORT, ensures the sport''s streak row. '
  'With p_match_plan: creates the confirmed matches synchronously and dispatches '
  'invite-only. Streak untouched (evaluate_weekly_goals owns it, per sport).';

GRANT EXECUTE ON FUNCTION public.record_weekly_checkin(SMALLINT, BOOLEAN, BOOLEAN, TEXT, JSONB, UUID) TO authenticated;


-- =============================================================================
-- 8. plan_weekly_matches_for_player — sport-scoped goal + committed count
--    (same signature as 20260713160000; body changes only in goal/committed)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.plan_weekly_matches_for_player(
  p_player_id     uuid,
  p_slots         jsonb,
  p_goal_override int  DEFAULT NULL,
  p_sport_id      uuid DEFAULT NULL
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
  min_rating_label    text,
  compatible_count    int
)
LANGUAGE plpgsql
VOLATILE
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
  v_sport         record;
  v_fac           record;
  v_duration_min  int;
  v_duration_enum match_duration_enum;
  v_location_type text;
  v_court_status  text;
  v_target_date   date;
  v_target_dow    text;
  v_slot          record;
  v_start         time;
  v_end           time;
  v_compatible    int;
  v_court_count   int;
  v_has_facility  boolean;
  d               int;
BEGIN
  DROP TABLE IF EXISTS tmp_plan_candidates;
  CREATE TEMP TABLE tmp_plan_candidates (
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
    min_rating_label    text,
    compatible_count    int  NOT NULL,
    court_count         int  NOT NULL DEFAULT 0,
    dist_m              float
  ) ON COMMIT DROP;

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

  -- Goal is per sport. Sport-scoped call → that sport's declared goal.
  -- Agnostic call (legacy cron generator) → the SUM of this week's sport goals,
  -- i.e. the player's total weekly games target across sports.
  v_goal := p_goal_override;
  IF v_goal IS NULL THEN
    IF p_sport_id IS NOT NULL THEN
      SELECT wc.frequency_goal INTO v_goal
        FROM public.player_weekly_checkin wc
       WHERE wc.player_id = p_player_id
         AND wc.sport_id = p_sport_id
         AND wc.week_start_date = v_week_start;
    ELSE
      SELECT sum(wc.frequency_goal)::int INTO v_goal
        FROM public.player_weekly_checkin wc
       WHERE wc.player_id = p_player_id
         AND wc.week_start_date = v_week_start;
    END IF;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = p_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  v_committed := public.count_checkin_window_committed_matches(p_player_id, v_today, p_sport_id);
  v_to_create := GREATEST(0, v_goal - COALESCE(v_committed, 0));

  IF v_to_create <= 0 THEN
    RETURN;
  END IF;

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
             prs.rating_score_id          AS min_rating_score_id,
             rs.label::text               AS min_rating_label
        FROM public.player_sport ps
        JOIN public.sport s ON s.id = ps.sport_id
        LEFT JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
        LEFT JOIN public.rating_score rs ON rs.id = prs.rating_score_id
       WHERE ps.player_id = p_player_id
         AND ps.is_active = TRUE
         AND (p_sport_id IS NULL OR ps.sport_id = p_sport_id)
       ORDER BY ps.is_primary DESC NULLS LAST, ps.updated_at DESC
    LOOP
      -- One auto match per (sport, day) — record_weekly_checkin's rule. A live
      -- auto match anywhere on this date removes the whole day for this sport.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.match m2
         WHERE m2.created_by = p_player_id
           AND m2.is_auto_generated = TRUE
           AND m2.cancelled_at IS NULL
           AND m2.sport_id = v_sport.sport_id
           AND m2.match_date = v_target_date
      );

      <<hour_loop>>
      FOR v_slot IN
        SELECT DISTINCT sl.hour AS hour_of_day
          FROM jsonb_to_recordset(COALESCE(p_slots, '[]'::jsonb)) AS sl(day text, hour int)
         WHERE sl.day = v_target_dow
           AND NOT (v_target_date = v_today AND sl.hour <= v_now_hour)
         ORDER BY sl.hour
      LOOP
        v_duration_enum := COALESCE(NULLIF(v_sport.duration, 'custom'), '60'::match_duration_enum);
        v_duration_min  := COALESCE(
          public.parse_match_duration_to_minutes(v_duration_enum::text), 60
        );
        v_start := make_time(v_slot.hour_of_day, 0, 0);
        v_end   := v_start + (v_duration_min || ' minutes')::interval;

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

        v_has_facility := FALSE;

        FOR v_fac IN
          SELECT f.id AS facility_id,
                 f.name AS facility_name,
                 f.address,
                 f.is_first_come_first_serve AS is_fcfs,
                 ( SELECT count(DISTINCT fas.external_court_id)
                     FROM public.facility_availability_snapshot fas
                    WHERE fas.facility_id = f.id
                      AND fas.is_available = TRUE
                      AND (fas.sport_id = v_sport.sport_id OR fas.sport_id IS NULL)
                      AND fas.slot_start =
                          ((v_target_date + make_time(v_slot.hour_of_day, 0, 0))::timestamp
                             AT TIME ZONE v_tz)
                 ) AS court_count,
                 CASE WHEN v_player_loc IS NOT NULL AND f.location IS NOT NULL
                      THEN extensions.ST_Distance(v_player_loc, f.location) END AS dist_m
            FROM public.player_favorite_facility pff
            JOIN public.facility f
              ON f.id = pff.facility_id AND f.is_active = TRUE
           WHERE pff.player_id = p_player_id
             AND (pff.sport_id = v_sport.sport_id OR pff.sport_id IS NULL)
        LOOP
          v_has_facility := TRUE;
          v_court_count  := COALESCE(v_fac.court_count, 0);
          v_compatible   := public.count_auto_invite_candidates_for_slot(
                              p_player_id, v_sport.sport_id, v_fac.facility_id,
                              v_target_date, v_start, v_end, NULL,
                              COALESCE(v_sport.match_type, 'both'::match_type_enum)
                            );

          INSERT INTO tmp_plan_candidates (
            sport_id, sport_name, match_date, start_time, end_time, duration, match_type,
            location_type, facility_id, facility_name, facility_address, court_status,
            min_rating_score_id, min_rating_label, compatible_count, court_count, dist_m
          ) VALUES (
            v_sport.sport_id, v_sport.sport_name, v_target_date, v_start, v_end,
            v_duration_enum, COALESCE(v_sport.match_type, 'both'::match_type_enum),
            'facility', v_fac.facility_id, v_fac.facility_name, v_fac.address,
            'to_reserve',
            v_sport.min_rating_score_id, v_sport.min_rating_label,
            v_compatible, v_court_count, v_fac.dist_m
          );
        END LOOP;

        IF NOT v_has_facility THEN
          INSERT INTO tmp_plan_candidates (
            sport_id, sport_name, match_date, start_time, end_time, duration, match_type,
            location_type, facility_id, facility_name, facility_address, court_status,
            min_rating_score_id, min_rating_label, compatible_count, court_count, dist_m
          ) VALUES (
            v_sport.sport_id, v_sport.sport_name, v_target_date, v_start, v_end,
            v_duration_enum, COALESCE(v_sport.match_type, 'both'::match_type_enum),
            'tbd', NULL, NULL, NULL, NULL,
            v_sport.min_rating_score_id, v_sport.min_rating_label,
            0, 0, NULL
          );
        END IF;
      END LOOP hour_loop;
    END LOOP;
  END LOOP day_loop;

  RETURN QUERY
  WITH best_per_slot AS (
    SELECT DISTINCT ON (c.sport_id, c.match_date, c.start_time)
           c.*
      FROM tmp_plan_candidates c
     ORDER BY c.sport_id, c.match_date, c.start_time,
              c.compatible_count DESC,
              c.court_count DESC,
              c.dist_m ASC NULLS LAST
  ),
  best_per_day AS (
    SELECT DISTINCT ON (b.sport_id, b.match_date)
           b.*
      FROM best_per_slot b
     ORDER BY b.sport_id, b.match_date,
              b.compatible_count DESC,
              b.court_count DESC,
              b.start_time ASC,
              b.dist_m ASC NULLS LAST
  )
  SELECT b.sport_id, b.sport_name, b.match_date, b.start_time, b.end_time,
         b.duration, b.match_type, b.location_type, b.facility_id, b.facility_name,
         b.facility_address, b.court_status, b.min_rating_score_id, b.min_rating_label,
         b.compatible_count
    FROM best_per_day b
   ORDER BY b.compatible_count DESC,
            b.match_date ASC,
            b.start_time ASC,
            b.court_count DESC,
            b.dist_m ASC NULLS LAST
   LIMIT v_to_create;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.plan_weekly_matches_for_player(uuid, jsonb, int, uuid) IS
  'PURE planner (zero writes). p_sport_id scopes candidates, the weekly goal '
  'and the committed count to one sport; agnostic calls (legacy cron) use the '
  'sum of the week''s sport goals and the all-sports committed count.';


-- =============================================================================
-- 9. get_checkin_match_plan — sport-scoped goal + committed count
--    (same signature as 20260713160000; body changes only in goal/committed)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_checkin_match_plan(
  p_slots          jsonb,
  p_frequency_goal smallint DEFAULT NULL,
  p_timezone       text     DEFAULT NULL,
  p_max_invitees   int      DEFAULT 50,
  p_sport_id       uuid     DEFAULT NULL
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
  v_auto_invite boolean;
  v_plan      record;
  v_invitees  jsonb;
  v_courts    int;
  v_proposals jsonb := '[]'::jsonb;
BEGIN
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL — must be called as an authenticated user';
  END IF;

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

  -- Goal is per sport (sum across sports on agnostic calls — mirrors planner).
  v_goal := p_frequency_goal;
  IF v_goal IS NULL THEN
    IF p_sport_id IS NOT NULL THEN
      SELECT wc.frequency_goal INTO v_goal
        FROM public.player_weekly_checkin wc
       WHERE wc.player_id = v_player_id
         AND wc.sport_id = p_sport_id
         AND wc.week_start_date = v_week;
    ELSE
      SELECT sum(wc.frequency_goal)::int INTO v_goal
        FROM public.player_weekly_checkin wc
       WHERE wc.player_id = v_player_id
         AND wc.week_start_date = v_week;
    END IF;
  END IF;
  IF v_goal IS NULL THEN
    SELECT pref.last_frequency_goal INTO v_goal
      FROM public.player_check_in_preferences pref
     WHERE pref.player_id = v_player_id;
  END IF;
  v_goal := COALESCE(v_goal, 3);

  v_committed := public.count_checkin_window_committed_matches(v_player_id, v_today, p_sport_id);

  SELECT
    NOT COALESCE(pref.auto_create_matches, TRUE),
    COALESCE(pref.auto_invite_players, TRUE)
    INTO v_opted_out, v_auto_invite
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;
  v_opted_out   := COALESCE(v_opted_out, FALSE);
  v_auto_invite := COALESCE(v_auto_invite, TRUE);

  FOR v_plan IN
    SELECT * FROM public.plan_weekly_matches_for_player(v_player_id, p_slots, v_goal, p_sport_id)
  LOOP
    -- Candidates surface regardless of the saved auto-invite pref — the deck's
    -- selection decides who gets invited and re-persists the pref on submit.
    IF v_plan.facility_id IS NOT NULL THEN
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
    ELSE
      v_invitees := '[]'::jsonb;
    END IF;

    IF v_plan.facility_id IS NOT NULL THEN
      SELECT count(DISTINCT fas.external_court_id) INTO v_courts
        FROM public.facility_availability_snapshot fas
       WHERE fas.facility_id = v_plan.facility_id
         AND fas.is_available = TRUE
         AND (fas.sport_id = v_plan.sport_id OR fas.sport_id IS NULL)
         AND fas.slot_start =
             ((v_plan.match_date + v_plan.start_time)::timestamp AT TIME ZONE v_tz);
    ELSE
      v_courts := 0;
    END IF;

    v_proposals := v_proposals || jsonb_build_object(
      'key',               v_plan.sport_id::text || ':' || v_plan.match_date::text || ':' || EXTRACT(hour FROM v_plan.start_time)::int,
      'sport_id',          v_plan.sport_id,
      'sport_name',        v_plan.sport_name,
      'match_date',        v_plan.match_date,
      'start_time',        v_plan.start_time,
      'end_time',          v_plan.end_time,
      'start_hour',        EXTRACT(hour FROM v_plan.start_time)::int,
      'duration',          v_plan.duration,
      'match_type',        v_plan.match_type,
      'location_type',     v_plan.location_type,
      'facility_id',       v_plan.facility_id,
      'facility_name',     v_plan.facility_name,
      'facility_address',  v_plan.facility_address,
      'min_rating_label',  v_plan.min_rating_label,
      'available_courts',  COALESCE(v_courts, 0),
      'compatible_count',  COALESCE(v_plan.compatible_count, 0),
      'invitees',          v_invitees
    );
  END LOOP;

  RETURN jsonb_build_object(
    'goal',                v_goal,
    'committed_count',     COALESCE(v_committed, 0),
    'opted_out',           v_opted_out,
    'auto_invite_enabled', v_auto_invite,
    'proposals',           v_proposals
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int, uuid) IS
  'Check-in wizard plan PREVIEW. p_sport_id scopes proposals, the weekly goal '
  'and the committed count to the wizard''s sport mode (NULL = all active '
  'sports, goal summed). Invitee candidates returned regardless of '
  'auto_invite_players — the deck''s selection decides invites.';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int, uuid) TO authenticated, service_role;
