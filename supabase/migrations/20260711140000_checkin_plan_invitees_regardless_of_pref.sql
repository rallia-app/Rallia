-- =============================================================================
-- Weekly check-in plan preview: return invite candidates regardless of the
-- saved auto_invite_players preference
--
-- The preview zeroed out invitees whenever auto_invite_players was false. With
-- the plan deck, the submit persists that pref FROM the player's selection
-- (kept ≥1 invitee → true, kept none → false), which made the off state
-- self-reinforcing: one no-invitee submit → pref false → next preview shows no
-- candidates → the player can never select anyone → pref stays false forever.
--
-- The deck's per-card selection IS the invite decision now, so the preview
-- always surfaces candidates for facility proposals; auto_invite_enabled stays
-- in the payload for observability. The invite DISPATCH (edge function) still
-- honors the pref, which the submit keeps in sync with the actual selection.
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

  v_committed := public.count_checkin_window_committed_matches(v_player_id, v_today);

  SELECT
    NOT COALESCE(pref.auto_create_matches, TRUE),
    COALESCE(pref.auto_invite_players, TRUE)
    INTO v_opted_out, v_auto_invite
    FROM public.player_check_in_preferences pref
   WHERE pref.player_id = v_player_id;
  v_opted_out   := COALESCE(v_opted_out, FALSE);
  v_auto_invite := COALESCE(v_auto_invite, TRUE);

  FOR v_plan IN
    SELECT * FROM public.plan_weekly_matches_for_player(v_player_id, p_slots, v_goal)
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

COMMENT ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) IS
  'Check-in wizard plan PREVIEW: proposals ranked by compatible-player count, '
  'one per (sport, day), capped at weekly goal minus committed upcoming games. '
  'Invitee candidates are returned regardless of auto_invite_players — the plan '
  'deck''s selection decides invites and re-persists the pref on submit.';

REVOKE ALL ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_match_plan(jsonb, smallint, text, int) TO authenticated, service_role;
