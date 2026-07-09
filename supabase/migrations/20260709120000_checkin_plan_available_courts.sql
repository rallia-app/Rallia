-- =============================================================================
-- Weekly check-in plan preview: surface available-court count per proposal
--
-- The wizard's plan card wants to show "N courts available" like MatchCard does.
-- plan_weekly_matches_for_player already computes that count while RANKING
-- facilities, but discards it. Rather than widen the shared planner's return
-- type (a DROP + re-grant that ripples into the cron generator), recompute the
-- count here in the preview RPC — it has every input it needs (facility_id,
-- sport_id, match_date, start_time, tz) and the arithmetic is identical to the
-- planner's court_count subquery, so the badge matches the tier the planner
-- actually chose.
--
-- Facility proposals get their live count; TBD proposals get 0 (no court to
-- check). jsonb return shape only GAINS a field, so this is CREATE OR REPLACE —
-- the client ignores it until the next app version reads it.
-- =============================================================================
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
  v_courts    int;
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

    -- Live open-court count for the chosen (facility, slot) — same arithmetic
    -- the planner used to rank facilities. TBD proposals have no facility → 0.
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
      'available_courts', COALESCE(v_courts, 0),
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
  '(get_auto_invite_candidates_for_slot) and the live open-court count for the '
  'chosen facility/slot. Read-only. The client submits the confirmed selection '
  'back through record_weekly_checkin(p_match_plan).';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) TO authenticated, service_role;
